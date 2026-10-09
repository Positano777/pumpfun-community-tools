import type { D1Like } from './env';
import { randomToken, sha256Hex } from './auth';
import type { PaidPlan, Plan, SubscriptionShape } from './billing/stripe';

/**
 * Accounts, subscriptions, API keys, quotas and per-wallet watch
 * subscriptions, all in D1. Every function tolerates a missing database
 * (CLI, tests): reads return empty and writes are no-ops.
 */

export interface SubscriptionRow {
  id: string;
  wallet: string;
  plan: PaidPlan;
  status: string;
  customer: string | null;
  price_id: string | null;
  period_end: number | null;
  cancel_at_period_end: number;
  created_at: number;
  updated_at: number;
}

export interface AccountRow {
  wallet: string;
  email: string | null;
  stripe_customer: string | null;
  telegram_chat: string | null;
  telegram_code: string | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  created_at: number;
  updated_at: number;
}

export interface ApiKeyRow {
  hash: string;
  wallet: string;
  prefix: string;
  created_at: number;
  last_used: number | null;
  revoked_at: number | null;
}

export interface Entitlement {
  plan: Plan;
  subscription: SubscriptionRow | null;
}

/** Days a lapsed payment keeps access while Stripe retries. */
const GRACE_MS = 3 * 86_400_000;
const ENTITLED = new Set(['active', 'trialing', 'past_due']);
export const API_KEY_PREFIX = 'rh_live_';

export function isActive(sub: Pick<SubscriptionRow, 'status' | 'period_end'>, now = Date.now()): boolean {
  if (!ENTITLED.has(sub.status)) return false;
  return sub.period_end === null || sub.period_end + GRACE_MS > now;
}

/** The best live plan for a wallet: API outranks Pro. */
export async function entitlement(db: D1Like | undefined, wallet: string, now = Date.now()): Promise<Entitlement> {
  if (!db || !wallet) return { plan: 'free', subscription: null };
  const { results } = await db.prepare(`SELECT * FROM subscriptions WHERE wallet = ?1 ORDER BY updated_at DESC LIMIT 10`).bind(wallet).all<SubscriptionRow>();
  const live = results.filter((s) => isActive(s, now));
  const best = live.find((s) => s.plan === 'api') ?? live.find((s) => s.plan === 'pro') ?? null;
  return { plan: best?.plan ?? 'free', subscription: best };
}

export async function subscriptionById(db: D1Like | undefined, id: string): Promise<SubscriptionRow | null> {
  if (!db) return null;
  return db.prepare(`SELECT * FROM subscriptions WHERE id = ?1`).bind(id).first<SubscriptionRow>();
}

export interface SubscriptionPatch {
  wallet?: string | null;
  plan?: PaidPlan | null;
  status?: string;
  customer?: string | null;
  priceId?: string | null;
  periodEnd?: number | null;
  cancelAtPeriodEnd?: boolean;
}

/** Insert or merge a subscription; unknown fields keep their stored value. */
export async function upsertSubscription(db: D1Like | undefined, id: string, patch: SubscriptionPatch, now = Date.now()): Promise<void> {
  if (!db) return;
  await db
    .prepare(
      `INSERT INTO subscriptions (id, wallet, plan, status, customer, price_id, period_end, cancel_at_period_end, created_at, updated_at)
       VALUES (?1, COALESCE(?2, ''), COALESCE(?3, 'pro'), COALESCE(?4, 'incomplete'), ?5, ?6, ?7, COALESCE(?8, 0), ?9, ?9)
       ON CONFLICT(id) DO UPDATE SET
         wallet = CASE WHEN ?2 IS NOT NULL AND ?2 != '' THEN ?2 ELSE subscriptions.wallet END,
         plan = COALESCE(?3, subscriptions.plan),
         status = COALESCE(?4, subscriptions.status),
         customer = COALESCE(?5, subscriptions.customer),
         price_id = COALESCE(?6, subscriptions.price_id),
         period_end = COALESCE(?7, subscriptions.period_end),
         cancel_at_period_end = COALESCE(?8, subscriptions.cancel_at_period_end),
         updated_at = ?9`,
    )
    .bind(
      id,
      patch.wallet ?? null,
      patch.plan ?? null,
      patch.status ?? null,
      patch.customer ?? null,
      patch.priceId ?? null,
      patch.periodEnd ?? null,
      patch.cancelAtPeriodEnd === undefined ? null : patch.cancelAtPeriodEnd ? 1 : 0,
      now,
    )
    .run();
}

export function patchFromStripe(sub: SubscriptionShape, plan: PaidPlan | null, wallet: string | null): SubscriptionPatch {
  return { wallet, plan, status: sub.status, customer: sub.customer, priceId: sub.priceId, periodEnd: sub.periodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd };
}

// Accounts

export async function account(db: D1Like | undefined, wallet: string): Promise<AccountRow | null> {
  if (!db || !wallet) return null;
  return db.prepare(`SELECT * FROM accounts WHERE wallet = ?1`).bind(wallet).first<AccountRow>();
}

export async function accountByCustomer(db: D1Like | undefined, customer: string): Promise<AccountRow | null> {
  if (!db || !customer) return null;
  return db.prepare(`SELECT * FROM accounts WHERE stripe_customer = ?1 ORDER BY updated_at DESC LIMIT 1`).bind(customer).first<AccountRow>();
}

export interface AccountPatch {
  email?: string | null;
  stripeCustomer?: string | null;
  telegramChat?: string | null;
  telegramCode?: string | null;
  webhookUrl?: string | null;
  webhookSecret?: string | null;
}

/** Create the account row if needed and merge the given fields (null clears nothing). */
export async function ensureAccount(db: D1Like | undefined, wallet: string, patch: AccountPatch = {}, now = Date.now()): Promise<void> {
  if (!db || !wallet) return;
  await db
    .prepare(
      `INSERT INTO accounts (wallet, email, stripe_customer, telegram_chat, telegram_code, webhook_url, webhook_secret, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
       ON CONFLICT(wallet) DO UPDATE SET
         email = COALESCE(?2, accounts.email),
         stripe_customer = COALESCE(?3, accounts.stripe_customer),
         telegram_chat = COALESCE(?4, accounts.telegram_chat),
         telegram_code = COALESCE(?5, accounts.telegram_code),
         webhook_url = COALESCE(?6, accounts.webhook_url),
         webhook_secret = COALESCE(?7, accounts.webhook_secret),
         updated_at = ?8`,
    )
    .bind(wallet, patch.email ?? null, patch.stripeCustomer ?? null, patch.telegramChat ?? null, patch.telegramCode ?? null, patch.webhookUrl ?? null, patch.webhookSecret ?? null, now)
    .run();
}

/** Set the webhook URL (empty string removes it) with a fresh signing secret. */
export async function setWebhook(db: D1Like | undefined, wallet: string, url: string, now = Date.now()): Promise<string | null> {
  if (!db) return null;
  await ensureAccount(db, wallet, {}, now);
  const secret = url ? `whsec_${randomToken(32)}` : null;
  await db.prepare(`UPDATE accounts SET webhook_url = ?2, webhook_secret = ?3, updated_at = ?4 WHERE wallet = ?1`).bind(wallet, url || null, secret, now).run();
  return secret;
}

export async function newTelegramCode(db: D1Like | undefined, wallet: string, now = Date.now()): Promise<string> {
  const code = randomToken(20);
  if (!db) return code;
  await ensureAccount(db, wallet, {}, now);
  await db.prepare(`UPDATE accounts SET telegram_code = ?2, updated_at = ?3 WHERE wallet = ?1`).bind(wallet, code, now).run();
  return code;
}

/** Bind a Telegram chat to the wallet that generated `code`; returns the wallet. */
export async function bindTelegram(db: D1Like | undefined, code: string, chatId: string, now = Date.now()): Promise<string | null> {
  if (!db || !code) return null;
  const row = await db.prepare(`SELECT wallet FROM accounts WHERE telegram_code = ?1`).bind(code).first<{ wallet: string }>();
  if (!row) return null;
  await db.prepare(`UPDATE accounts SET telegram_chat = ?2, telegram_code = NULL, updated_at = ?3 WHERE wallet = ?1`).bind(row.wallet, chatId, now).run();
  return row.wallet;
}

export async function unlinkTelegram(db: D1Like | undefined, wallet: string, now = Date.now()): Promise<void> {
  if (!db) return;
  await db.prepare(`UPDATE accounts SET telegram_chat = NULL, telegram_code = NULL, updated_at = ?2 WHERE wallet = ?1`).bind(wallet, now).run();
}

// API keys

/** Issue a new key for the wallet, revoking earlier ones. The clear text is returned once. */
export async function issueApiKey(db: D1Like | undefined, wallet: string, now = Date.now()): Promise<{ key: string; prefix: string }> {
  const key = `${API_KEY_PREFIX}${randomToken(40)}`;
  const prefix = key.slice(0, API_KEY_PREFIX.length + 6);
  if (db) {
    await db.batch([
      db.prepare(`UPDATE api_keys SET revoked_at = ?2 WHERE wallet = ?1 AND revoked_at IS NULL`).bind(wallet, now),
      db.prepare(`INSERT INTO api_keys (hash, wallet, prefix, created_at) VALUES (?1, ?2, ?3, ?4)`).bind(await sha256Hex(key), wallet, prefix, now),
    ]);
  }
  return { key, prefix };
}

export async function apiKeyByValue(db: D1Like | undefined, key: string): Promise<ApiKeyRow | null> {
  if (!db || !key.startsWith(API_KEY_PREFIX)) return null;
  return db.prepare(`SELECT * FROM api_keys WHERE hash = ?1 AND revoked_at IS NULL`).bind(await sha256Hex(key)).first<ApiKeyRow>();
}

export async function activeApiKey(db: D1Like | undefined, wallet: string): Promise<ApiKeyRow | null> {
  if (!db) return null;
  return db.prepare(`SELECT * FROM api_keys WHERE wallet = ?1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`).bind(wallet).first<ApiKeyRow>();
}

export async function touchApiKey(db: D1Like | undefined, hash: string, now = Date.now()): Promise<void> {
  if (!db) return;
  await db.prepare(`UPDATE api_keys SET last_used = ?2 WHERE hash = ?1`).bind(hash, now).run();
}

export async function revokeApiKeys(db: D1Like | undefined, wallet: string, now = Date.now()): Promise<void> {
  if (!db) return;
  await db.prepare(`UPDATE api_keys SET revoked_at = ?2 WHERE wallet = ?1 AND revoked_at IS NULL`).bind(wallet, now).run();
}

// Quotas

export function dayPeriod(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function monthPeriod(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 7);
}

export interface Consumption {
  allowed: boolean;
  used: number;
  limit: number;
}

/** Count one unit against a subject's period; atomic in D1 (single upsert with RETURNING). */
export async function consume(db: D1Like | undefined, subject: string, period: string, limit: number): Promise<Consumption> {
  if (!db) return { allowed: true, used: 0, limit };
  const row = await db
    .prepare(`INSERT INTO usage_counters (subject, period, n) VALUES (?1, ?2, 1) ON CONFLICT(subject, period) DO UPDATE SET n = n + 1 RETURNING n`)
    .bind(subject, period)
    .first<{ n: number }>();
  const used = row?.n ?? 1;
  return { allowed: used <= limit, used, limit };
}

export async function usage(db: D1Like | undefined, subject: string, period: string): Promise<number> {
  if (!db) return 0;
  const row = await db.prepare(`SELECT n FROM usage_counters WHERE subject = ?1 AND period = ?2`).bind(subject, period).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Drop day counters older than two days and month counters older than forty. */
export async function pruneUsage(db: D1Like | undefined, now = Date.now()): Promise<void> {
  if (!db) return;
  await db.batch([
    db.prepare(`DELETE FROM usage_counters WHERE length(period) = 10 AND period < ?1`).bind(dayPeriod(now - 2 * 86_400_000)),
    db.prepare(`DELETE FROM usage_counters WHERE length(period) = 7 AND period < ?1`).bind(monthPeriod(now - 40 * 86_400_000)),
  ]);
}

// Stripe event ledger

/** True when the event has not been applied before (and records it now). */
export async function recordEvent(db: D1Like | undefined, id: string, type: string, now = Date.now()): Promise<boolean> {
  if (!db) return true;
  const seen = await db.prepare(`SELECT 1 AS one FROM stripe_events WHERE id = ?1`).bind(id).first<{ one: number }>();
  if (seen) return false;
  await db.prepare(`INSERT OR IGNORE INTO stripe_events (id, type, created_at) VALUES (?1, ?2, ?3)`).bind(id, type, now).run();
  return true;
}

// Watch subscriptions

export interface WatchRow {
  address: string;
  label: string | null;
  created_at: number;
  symbol: string | null;
  name: string | null;
  risk: number | null;
  grade: string | null;
}

export async function addWatchSub(db: D1Like | undefined, wallet: string, address: string, label: string | null, now = Date.now()): Promise<void> {
  if (!db) return;
  await db.prepare(`INSERT INTO watch_subs (wallet, address, label, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(wallet, address) DO NOTHING`).bind(wallet, address, label, now).run();
}

export async function removeWatchSub(db: D1Like | undefined, wallet: string, address: string): Promise<void> {
  if (!db) return;
  await db.prepare(`DELETE FROM watch_subs WHERE wallet = ?1 AND address = ?2`).bind(wallet, address).run();
}

export async function watchSubsFor(db: D1Like | undefined, wallet: string): Promise<WatchRow[]> {
  if (!db) return [];
  const { results } = await db
    .prepare(
      `SELECT w.address, w.label, w.created_at, s.symbol, s.name, s.risk, s.grade
         FROM watch_subs w LEFT JOIN scans s ON s.address = w.address
        WHERE w.wallet = ?1 ORDER BY w.created_at DESC LIMIT 100`,
    )
    .bind(wallet)
    .all<WatchRow>();
  return results;
}

/** Accounts subscribed to an address, with their delivery channels. */
export async function subscribersFor(db: D1Like | undefined, address: string): Promise<AccountRow[]> {
  if (!db) return [];
  const { results } = await db
    .prepare(`SELECT a.* FROM watch_subs w JOIN accounts a ON a.wallet = w.wallet WHERE w.address = ?1 LIMIT 200`)
    .bind(address)
    .all<AccountRow>();
  return results;
}

export interface AlertRow {
  address: string;
  severity: string;
  message: string;
  created_at: number;
  symbol: string | null;
}

export async function alertsForWallet(db: D1Like | undefined, wallet: string, limit = 30): Promise<AlertRow[]> {
  if (!db) return [];
  const { results } = await db
    .prepare(
      `SELECT al.address, al.severity, al.message, al.created_at, s.symbol
         FROM alerts al JOIN watch_subs w ON w.address = al.address AND w.wallet = ?1
         LEFT JOIN scans s ON s.address = al.address
        WHERE al.created_at >= w.created_at
        ORDER BY al.created_at DESC LIMIT ?2`,
    )
    .bind(wallet, limit)
    .all<AlertRow>();
  return results;
}
