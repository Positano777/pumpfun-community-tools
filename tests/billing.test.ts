import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as nodeSign } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import type { AppEnv, D1Like, D1Statement } from '../lib/env';
import { signSession, verifySession, signInMessage, verifyWalletSignature, issueNonce, takeNonce } from '../lib/auth';
import { formEncode, parseSubscription, verifyStripeSignature, signStripePayload, parseCheckoutSession } from '../lib/billing/stripe';
import { applyStripeEvent, parseEvent, pickWallet } from '../lib/billing/webhook';
import { validWebhookUrl, postWebhook } from '../lib/billing/alerts';
import { consume, entitlement, isActive, issueApiKey } from '../lib/account';
import { bearerToken, chargeApiCall, resolveAccess, scanGate } from '../lib/access';
import { HttpError } from '../lib/errors';

const WALLET = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const OTHER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

/** Just enough SQLite to run the account repository against; one method per statement family. */
class FakeD1 implements D1Like {
  subs = new Map<string, Record<string, unknown>>();
  accounts = new Map<string, Record<string, unknown>>();
  events = new Set<string>();
  counters = new Map<string, number>();
  keys = new Map<string, Record<string, unknown>>();

  prepare(sql: string): D1Statement {
    let args: unknown[] = [];
    const exec = (mode: 'first' | 'all' | 'run') => this.exec(sql.replace(/\s+/g, ' ').trim(), args, mode);
    const stmt: D1Statement = {
      bind: (...a: unknown[]) => {
        args = a;
        return stmt;
      },
      first: async <T,>() => exec('first') as T | null,
      all: async <T,>() => ({ results: (exec('all') ?? []) as T[] }),
      run: async () => exec('run'),
    };
    return stmt;
  }

  async batch(statements: D1Statement[]) {
    for (const s of statements) await s.run();
    return [];
  }

  private exec(sql: string, a: unknown[], mode: 'first' | 'all' | 'run'): unknown {
    const v = (x: unknown) => (x === undefined ? null : x);
    if (sql.startsWith('SELECT 1 AS one FROM stripe_events')) return this.events.has(String(a[0])) ? { one: 1 } : null;
    if (sql.startsWith('INSERT OR IGNORE INTO stripe_events')) return void this.events.add(String(a[0]));
    if (sql.startsWith('SELECT * FROM subscriptions WHERE id')) return this.subs.get(String(a[0])) ?? null;
    if (sql.startsWith('SELECT * FROM subscriptions WHERE wallet')) {
      const rows = [...this.subs.values()].filter((s) => s.wallet === a[0]).sort((x, y) => Number(y.updated_at) - Number(x.updated_at));
      return mode === 'all' ? rows : rows[0] ?? null;
    }
    if (sql.startsWith('INSERT INTO subscriptions')) {
      const [id, wallet, plan, status, customer, price, end, cancel, now] = a.map(v);
      const cur = this.subs.get(String(id));
      this.subs.set(String(id), cur
        ? { ...cur, wallet: wallet !== null && wallet !== '' ? wallet : cur.wallet, plan: plan ?? cur.plan, status: status ?? cur.status, customer: customer ?? cur.customer, price_id: price ?? cur.price_id, period_end: end ?? cur.period_end, cancel_at_period_end: cancel ?? cur.cancel_at_period_end, updated_at: now }
        : { id, wallet: wallet ?? '', plan: plan ?? 'pro', status: status ?? 'incomplete', customer, price_id: price, period_end: end, cancel_at_period_end: cancel ?? 0, created_at: now, updated_at: now });
      return undefined;
    }
    if (sql.startsWith('SELECT * FROM accounts WHERE wallet')) return this.accounts.get(String(a[0])) ?? null;
    if (sql.startsWith('SELECT * FROM accounts WHERE stripe_customer')) return [...this.accounts.values()].find((x) => x.stripe_customer === a[0]) ?? null;
    if (sql.startsWith('INSERT INTO accounts')) {
      const [wallet, email, customer, tgc, tgcode, whu, whs, now] = a.map(v);
      const cur = this.accounts.get(String(wallet));
      this.accounts.set(String(wallet), cur
        ? { ...cur, email: email ?? cur.email, stripe_customer: customer ?? cur.stripe_customer, telegram_chat: tgc ?? cur.telegram_chat, telegram_code: tgcode ?? cur.telegram_code, webhook_url: whu ?? cur.webhook_url, webhook_secret: whs ?? cur.webhook_secret, updated_at: now }
        : { wallet, email, stripe_customer: customer, telegram_chat: tgc, telegram_code: tgcode, webhook_url: whu, webhook_secret: whs, created_at: now, updated_at: now });
      return undefined;
    }
    if (sql.startsWith('INSERT INTO usage_counters')) {
      const k = `${a[0]}|${a[1]}`;
      const n = (this.counters.get(k) ?? 0) + 1;
      this.counters.set(k, n);
      return { n };
    }
    if (sql.startsWith('SELECT n FROM usage_counters')) {
      const n = this.counters.get(`${a[0]}|${a[1]}`);
      return n === undefined ? null : { n };
    }
    if (sql.startsWith('UPDATE api_keys SET revoked_at')) {
      for (const k of this.keys.values()) if (k.wallet === a[0] && !k.revoked_at) k.revoked_at = a[1];
      return undefined;
    }
    if (sql.startsWith('INSERT INTO api_keys')) return void this.keys.set(String(a[0]), { hash: a[0], wallet: a[1], prefix: a[2], created_at: a[3], last_used: null, revoked_at: null });
    if (sql.startsWith('SELECT * FROM api_keys WHERE hash')) {
      const k = this.keys.get(String(a[0]));
      return k && !k.revoked_at ? k : null;
    }
    if (sql.startsWith('SELECT * FROM api_keys WHERE wallet')) return [...this.keys.values()].filter((k) => k.wallet === a[0] && !k.revoked_at)[0] ?? null;
    if (sql.startsWith('UPDATE api_keys SET last_used')) {
      const k = this.keys.get(String(a[0]));
      if (k) k.last_used = a[1];
      return undefined;
    }
    throw new Error(`FakeD1 cannot run: ${sql.slice(0, 70)}`);
  }
}

function env(db: FakeD1, extra: Partial<AppEnv> = {}): AppEnv {
  return { DB: db, STRIPE_PRICE_PRO: 'price_pro', STRIPE_PRICE_API: 'price_api', SESSION_SECRET: 'unit-test-secret', ...extra } as AppEnv;
}

function subscription(id: string, price: string, status: string, extra: Record<string, unknown> = {}) {
  return { id, object: 'subscription', status, customer: 'cus_1', cancel_at_period_end: false, metadata: {}, items: { data: [{ id: 'si_1', price: { id: price }, current_period_end: 1_900_000_000 }] }, ...extra };
}

test('stripe form encoding nests objects and arrays the way the API expects', () => {
  const body = formEncode({ mode: 'subscription', line_items: [{ price: 'price_1', quantity: 1 }], metadata: { wallet: WALLET }, skip: undefined });
  assert.equal(decodeURIComponent(body), `mode=subscription&line_items[0][price]=price_1&line_items[0][quantity]=1&metadata[wallet]=${WALLET}`);
});

test('subscriptions parse across API versions', () => {
  const modern = parseSubscription(subscription('sub_1', 'price_pro', 'active'));
  assert.equal(modern?.priceId, 'price_pro');
  assert.equal(modern?.periodEnd, 1_900_000_000_000);
  const legacy = parseSubscription({ id: 'sub_2', status: 'past_due', customer: { id: 'cus_9' }, current_period_end: 1_800_000_000, cancel_at_period_end: true, items: { data: [{ price: { id: 'price_api' } }] } });
  assert.equal(legacy?.customer, 'cus_9');
  assert.equal(legacy?.periodEnd, 1_800_000_000_000);
  assert.equal(legacy?.cancelAtPeriodEnd, true);
  assert.equal(parseSubscription({ nope: true }), null);
});

test('webhook signatures verify, and stale or foreign ones do not', async () => {
  const payload = '{"id":"evt_1","type":"ping"}';
  const now = 1_790_000_000_000;
  const header = await signStripePayload(payload, 'whsec_test', now);
  assert.equal(await verifyStripeSignature(payload, header, 'whsec_test', now + 10_000), true);
  assert.equal(await verifyStripeSignature(payload, header, 'whsec_other', now), false);
  assert.equal(await verifyStripeSignature(payload + ' ', header, 'whsec_test', now), false);
  assert.equal(await verifyStripeSignature(payload, header, 'whsec_test', now + 600_000), false, 'outside tolerance');
  assert.equal(await verifyStripeSignature(payload, null, 'whsec_test', now), false);
});

test('session cookies round-trip, expire and reject tampering', async () => {
  const token = await signSession('s3cret', WALLET, 1_790_000_000_000);
  assert.equal(await verifySession('s3cret', token, 1_790_000_000_000 + 1000), WALLET);
  assert.equal(await verifySession('other', token), null);
  assert.equal(await verifySession('s3cret', token, 1_790_000_000_000 + 31 * 86_400_000), null);
  const [payload, sig] = token.split('.');
  assert.equal(await verifySession('s3cret', `${payload}x.${sig}`), null);
});

test('sign-in with Solana: a real Ed25519 signature over the issued message', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = Buffer.from((publicKey.export({ format: 'jwk' }) as { x: string }).x, 'base64url');
  const wallet = new PublicKey(raw).toBase58();
  const nonce = await issueNonce(undefined, wallet);
  const message = signInMessage(wallet, nonce.nonce, nonce.issuedAt);
  const signature = new Uint8Array(nodeSign(null, Buffer.from(message), privateKey));
  assert.equal(await verifyWalletSignature(wallet, message, signature), true);
  assert.equal(await verifyWalletSignature(wallet, message + '!', signature), false);
  assert.equal(await verifyWalletSignature(OTHER, message, signature), false);
  assert.ok(await takeNonce(undefined, wallet), 'nonce is there once');
  assert.equal(await takeNonce(undefined, wallet), null, 'and consumed');
});

test('a Payment Link subscription is attributed when the checkout session lands', async () => {
  const db = new FakeD1();
  const e = env(db);
  // Stripe may deliver the subscription before the checkout session.
  const created = parseEvent({ id: 'evt_a', type: 'customer.subscription.created', data: { object: subscription('sub_pl', 'price_pro', 'active') } })!;
  assert.equal(await applyStripeEvent(e, created), 'subscription-unattributed');
  assert.equal((await entitlement(db, WALLET)).plan, 'free');

  const done = parseEvent({
    id: 'evt_b', type: 'checkout.session.completed',
    data: { object: { id: 'cs_1', mode: 'subscription', status: 'complete', client_reference_id: WALLET, customer: 'cus_1', subscription: 'sub_pl', metadata: { app: 'rughawk', plan: 'pro' }, customer_details: { email: 'bob@example.com' } } },
  })!;
  assert.equal(await applyStripeEvent(e, done), 'checkout');
  const ent = await entitlement(db, WALLET);
  assert.equal(ent.plan, 'pro');
  assert.equal(ent.subscription?.price_id, 'price_pro');
  assert.equal(db.accounts.get(WALLET)?.email, 'bob@example.com');
  assert.equal(await applyStripeEvent(e, done), 'duplicate', 'retries are no-ops');

  const upgraded = parseEvent({ id: 'evt_c', type: 'customer.subscription.updated', data: { object: subscription('sub_pl', 'price_api', 'active') } })!;
  assert.equal(await applyStripeEvent(e, upgraded), 'subscription');
  assert.equal((await entitlement(db, WALLET)).plan, 'api');

  const canceled = parseEvent({ id: 'evt_d', type: 'customer.subscription.deleted', data: { object: subscription('sub_pl', 'price_api', 'canceled') } })!;
  assert.equal(await applyStripeEvent(e, canceled), 'subscription');
  assert.equal((await entitlement(db, WALLET)).plan, 'free');
});

test('other products on the same Stripe account are ignored', async () => {
  const db = new FakeD1();
  const e = env(db);
  const foreign = parseEvent({ id: 'evt_f', type: 'customer.subscription.created', data: { object: subscription('sub_typemic', 'price_typemic', 'active', { metadata: { plan: 'pro' } }) } })!;
  assert.equal(await applyStripeEvent(e, foreign), 'foreign');
  assert.equal(db.subs.size, 0);
  const session = parseEvent({ id: 'evt_g', type: 'checkout.session.completed', data: { object: { id: 'cs_2', mode: 'subscription', client_reference_id: WALLET, subscription: 'sub_typemic', metadata: {} } } })!;
  assert.equal(await applyStripeEvent(e, session), 'foreign');
  assert.equal(db.subs.size, 0);
});

test('a failed invoice keeps access during the grace period, not beyond', async () => {
  const db = new FakeD1();
  const e = env(db);
  await applyStripeEvent(e, parseEvent({ id: 'evt_1', type: 'customer.subscription.created', data: { object: subscription('sub_x', 'price_pro', 'active', { metadata: { wallet: WALLET, app: 'rughawk' } }) } })!);
  assert.equal((await entitlement(db, WALLET)).plan, 'pro');
  assert.equal(await applyStripeEvent(e, parseEvent({ id: 'evt_2', type: 'invoice.payment_failed', data: { object: { id: 'in_1', parent: { subscription_details: { subscription: 'sub_x' } } } } })!), 'past-due');
  const periodEnd = 1_900_000_000_000;
  assert.equal((await entitlement(db, WALLET, periodEnd + 86_400_000)).plan, 'pro', 'one day late: still inside the grace window');
  assert.equal((await entitlement(db, WALLET, periodEnd + 4 * 86_400_000)).plan, 'free', 'four days late: lapsed');
  assert.equal(isActive({ status: 'canceled', period_end: null }), false);
  assert.equal(isActive({ status: 'trialing', period_end: null }), true);
});

test('API keys authenticate, meter monthly, and stop at the quota', async () => {
  const db = new FakeD1();
  const e = env(db, { API_CALLS_PER_MONTH: '2' });
  await applyStripeEvent(e, parseEvent({ id: 'evt_k', type: 'customer.subscription.created', data: { object: subscription('sub_api', 'price_api', 'active', { metadata: { wallet: WALLET, app: 'rughawk' } }) } })!);
  const { key, prefix } = await issueApiKey(db, WALLET);
  assert.ok(key.startsWith('rh_live_') && key.startsWith(prefix));
  const req = (k: string) => new Request('https://rughawk.xyz/api/scan/token?mint=x', { headers: { authorization: `Bearer ${k}` } });
  const access = await resolveAccess(req(key), e);
  assert.equal(access.via, 'apikey');
  assert.equal(access.plan, 'api');
  assert.deepEqual(await chargeApiCall(e, access), { used: 1, limit: 2 });
  assert.deepEqual(await chargeApiCall(e, access), { used: 2, limit: 2 });
  await assert.rejects(() => chargeApiCall(e, access), (err: unknown) => err instanceof HttpError && err.status === 429);
  await assert.rejects(() => resolveAccess(req('rh_live_nope'), e), (err: unknown) => err instanceof HttpError && err.status === 401);
  assert.equal(scanGate(e, access), undefined, 'key holders are not metered per IP');
  const { key: rotated } = await issueApiKey(db, WALLET);
  await assert.rejects(() => resolveAccess(req(key), e), 'the old key is revoked');
  assert.equal((await resolveAccess(req(rotated), e)).wallet, WALLET);
});

test('free visitors get a daily engine budget per IP; a Pro session does not', async () => {
  const db = new FakeD1();
  const e = env(db, { FREE_SCANS_PER_DAY: '1' });
  const anon = await resolveAccess(new Request('https://rughawk.xyz/api/scan', { headers: { 'cf-connecting-ip': '1.2.3.4' } }), e);
  assert.equal(anon.via, 'anon');
  const gate = scanGate(e, anon)!;
  await gate();
  await assert.rejects(gate, (err: unknown) => err instanceof HttpError && err.status === 402 && err.extra.upgrade === '/#pricing');
  const sameIp = scanGate(e, await resolveAccess(new Request('https://rughawk.xyz/api/scan', { headers: { 'cf-connecting-ip': '1.2.3.4' } }), e))!;
  await assert.rejects(sameIp, 'the counter is per IP, not per request');

  await applyStripeEvent(e, parseEvent({ id: 'evt_p', type: 'customer.subscription.created', data: { object: subscription('sub_pro', 'price_pro', 'active', { metadata: { wallet: WALLET, app: 'rughawk' } }) } })!);
  const cookie = `rh_session=${await signSession('unit-test-secret', WALLET)}`;
  const pro = await resolveAccess(new Request('https://rughawk.xyz/api/scan', { headers: { cookie, 'cf-connecting-ip': '1.2.3.4' } }), e);
  assert.equal(pro.via, 'session');
  assert.equal(pro.plan, 'pro');
  assert.equal(scanGate(e, pro), undefined);
  assert.equal(await chargeApiCall(e, pro), null);
  assert.equal(bearerToken(new Request('https://x', { headers: { authorization: 'Bearer abc' } })), 'abc');
  assert.equal(bearerToken(new Request('https://x')), null);
});

test('usage counters are atomic upserts', async () => {
  const db = new FakeD1();
  assert.deepEqual(await consume(db, 'ip:1', '2026-10-09', 2), { allowed: true, used: 1, limit: 2 });
  assert.deepEqual(await consume(db, 'ip:1', '2026-10-09', 2), { allowed: true, used: 2, limit: 2 });
  assert.deepEqual(await consume(db, 'ip:1', '2026-10-09', 2), { allowed: false, used: 3, limit: 2 });
  assert.deepEqual(await consume(db, 'ip:1', '2026-10-10', 2), { allowed: true, used: 1, limit: 2 });
});

test('webhook alert targets and signatures', async () => {
  assert.equal(validWebhookUrl('https://bot.example.com/hook'), true);
  assert.equal(validWebhookUrl('http://bot.example.com/hook'), false);
  assert.equal(validWebhookUrl('https://10.0.0.5/hook'), false);
  assert.equal(validWebhookUrl('https://localhost/hook'), false);
  assert.equal(validWebhookUrl('https://user:pw@bot.example.com/hook'), false);
  let seen: { headers: Headers; body: string } | null = null;
  const fake = (async (_u: RequestInfo | URL, init?: RequestInit) => {
    seen = { headers: new Headers(init?.headers), body: String(init?.body) };
    return new Response('ok');
  }) as typeof fetch;
  const payload = { event: 'watchtower.alert' as const, address: WALLET, label: 'BONK', alerts: [{ severity: 'high', message: 'Risk worsened' }], url: 'https://rughawk.xyz/token/x', sentAt: '2026-10-09T00:00:00.000Z' };
  assert.equal(await postWebhook('https://bot.example.com/hook', 'whsec_abc', payload, fake, 1_790_000_000_000), true);
  const sig = seen!.headers.get('x-rughawk-signature')!;
  assert.ok(sig.startsWith('t=1790000000,v1='));
  assert.equal(await verifyStripeSignature(seen!.body, sig, 'whsec_abc', 1_790_000_000_000), true, 'same scheme as Stripe, verifiable with the same code');
});

test('checkout sessions and wallets parse defensively', () => {
  const s = parseCheckoutSession({ id: 'cs_1', mode: 'subscription', client_reference_id: WALLET, customer: { id: 'cus_2' }, subscription: subscription('sub_9', 'price_pro', 'active'), metadata: { app: 'rughawk' }, customer_email: 'x@y.z' });
  assert.equal(s?.customer, 'cus_2');
  assert.equal(s?.subscriptionId, 'sub_9');
  assert.equal(s?.email, 'x@y.z');
  assert.equal(pickWallet('not-a-wallet', { wallet: WALLET }), WALLET);
  assert.equal(pickWallet(null, {}), null);
  assert.equal(parseEvent({ id: 'evt', type: 'x' }), null);
});
