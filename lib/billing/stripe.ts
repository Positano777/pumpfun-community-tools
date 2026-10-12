import type { AppEnv } from '../env';
import { HttpError } from '../errors';
import { hmacSha256, timingSafeEqual } from '../auth';

/**
 * Stripe over plain fetch (no SDK: the Worker bundle stays small and the
 * calls are a handful of REST endpoints). Two modes:
 *
 *  - With STRIPE_SECRET_KEY: Checkout Sessions carry the wallet in
 *    client_reference_id and metadata, Billing Portal sessions let customers
 *    manage the subscription, and the post-checkout sync reads the session.
 *  - Without it: Payment Links (created in the dashboard or by the API) take
 *    the wallet as ?client_reference_id, and the hosted portal login page
 *    covers management. Fulfilment is the webhook either way.
 */

export type Plan = 'free' | 'pro' | 'api';
export type PaidPlan = 'pro' | 'api';

/** metadata.app on everything RugHawk creates; the webhook ignores other products on the account. */
export const APP_TAG = 'rughawk';

export const PLANS: Record<PaidPlan, { name: string; price: string; amountCents: number }> = {
  pro: { name: 'Pro', price: '$19/month', amountCents: 1900 },
  api: { name: 'API', price: '$99/month', amountCents: 9900 },
};

export function isPaidPlan(value: unknown): value is PaidPlan {
  return value === 'pro' || value === 'api';
}

type Params = Record<string, unknown>;

/** Stripe's form encoding: nested objects and arrays become bracket keys. */
export function formEncode(params: Params): string {
  const pairs: string[] = [];
  const walk = (value: unknown, key: string) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${key}[${i}]`));
    else if (typeof value === 'object') Object.entries(value as Params).forEach(([k, v]) => walk(v, key ? `${key}[${k}]` : k));
    else pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  };
  Object.entries(params).forEach(([k, v]) => walk(v, k));
  return pairs.join('&');
}

export async function stripe<T>(secret: string, method: 'GET' | 'POST' | 'DELETE', path: string, params: Params = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  const query = method === 'GET' ? formEncode(params) : '';
  const res = await fetchImpl(`https://api.stripe.com${path}${query ? `?${query}` : ''}`, {
    method,
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'POST' ? formEncode(params) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) throw new HttpError(502, `Payment processor: ${data.error?.message ?? `HTTP ${res.status}`}`);
  return data as T;
}

export function priceFor(env: AppEnv, plan: PaidPlan): string | undefined {
  return plan === 'pro' ? env.STRIPE_PRICE_PRO : env.STRIPE_PRICE_API;
}

export function planForPrice(env: AppEnv, priceId: string | null | undefined): PaidPlan | null {
  if (!priceId) return null;
  if (priceId === env.STRIPE_PRICE_PRO) return 'pro';
  if (priceId === env.STRIPE_PRICE_API) return 'api';
  return null;
}

export function planFromMetadata(meta: unknown): PaidPlan | null {
  const plan = (meta as { plan?: unknown } | null | undefined)?.plan;
  return isPaidPlan(plan) ? plan : null;
}

export interface SubscriptionShape {
  id: string;
  status: string;
  customer: string | null;
  priceId: string | null;
  /** unix ms */
  periodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  metadata: Record<string, unknown>;
}

/** Normalise a subscription object across API versions (period moved to items in 2025). */
export function parseSubscription(sub: unknown): SubscriptionShape | null {
  const s = sub as {
    id?: unknown; status?: unknown; customer?: unknown; cancel_at_period_end?: unknown; current_period_end?: unknown; metadata?: unknown;
    items?: { data?: { price?: { id?: unknown }; current_period_end?: unknown }[] };
  } | null;
  if (!s || typeof s.id !== 'string' || typeof s.status !== 'string') return null;
  const item = s.items?.data?.[0];
  const customer = typeof s.customer === 'string' ? s.customer : ((s.customer as { id?: unknown } | null)?.id as string | undefined) ?? null;
  const end = typeof s.current_period_end === 'number' ? s.current_period_end : typeof item?.current_period_end === 'number' ? item.current_period_end : null;
  return {
    id: s.id,
    status: s.status,
    customer,
    priceId: typeof item?.price?.id === 'string' ? item.price.id : null,
    periodEnd: end === null ? null : end * 1000,
    cancelAtPeriodEnd: s.cancel_at_period_end === true,
    metadata: (s.metadata && typeof s.metadata === 'object' ? s.metadata : {}) as Record<string, unknown>,
  };
}

export function appUrl(env: AppEnv): string {
  return (env.NEXT_PUBLIC_APP_URL ?? 'https://rughawk.xyz').replace(/\/$/, '');
}

export function billingMode(env: AppEnv): 'checkout' | 'links' | 'off' {
  if (env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_PRO && env.STRIPE_PRICE_API) return 'checkout';
  if (env.STRIPE_PAYMENT_LINK_PRO && env.STRIPE_PAYMENT_LINK_API) return 'links';
  return 'off';
}

/** URL to send a signed-in wallet to for a plan. */
export async function checkoutUrl(env: AppEnv, opts: { wallet: string; plan: PaidPlan; customer?: string | null; email?: string | null }, fetchImpl?: typeof fetch): Promise<string> {
  const mode = billingMode(env);
  if (mode === 'off') throw new HttpError(503, 'Billing is not configured yet. Email security@raptorlabs.dev and we will set you up by hand.');
  if (mode === 'links') {
    const link = opts.plan === 'pro' ? env.STRIPE_PAYMENT_LINK_PRO! : env.STRIPE_PAYMENT_LINK_API!;
    const u = new URL(link);
    u.searchParams.set('client_reference_id', opts.wallet);
    if (opts.email) u.searchParams.set('prefilled_email', opts.email);
    return u.toString();
  }
  const base = appUrl(env);
  const session = await stripe<{ url?: string }>(env.STRIPE_SECRET_KEY!, 'POST', '/v1/checkout/sessions', {
    mode: 'subscription',
    line_items: [{ price: priceFor(env, opts.plan), quantity: 1 }],
    client_reference_id: opts.wallet,
    metadata: { wallet: opts.wallet, plan: opts.plan, app: APP_TAG },
    subscription_data: { metadata: { wallet: opts.wallet, plan: opts.plan, app: APP_TAG } },
    success_url: `${base}/account?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/#pricing`,
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    ...(opts.customer ? { customer: opts.customer } : opts.email ? { customer_email: opts.email } : {}),
  }, fetchImpl);
  if (!session.url) throw new HttpError(502, 'The payment processor did not return a checkout URL');
  return session.url;
}

/** URL where a customer manages the subscription (portal session or hosted login page). */
export async function portalUrl(env: AppEnv, customer: string | null, fetchImpl?: typeof fetch): Promise<string> {
  if (env.STRIPE_SECRET_KEY && customer) {
    const session = await stripe<{ url?: string }>(env.STRIPE_SECRET_KEY, 'POST', '/v1/billing_portal/sessions', { customer, return_url: `${appUrl(env)}/account` }, fetchImpl);
    if (session.url) return session.url;
  }
  if (env.STRIPE_PORTAL_URL) return env.STRIPE_PORTAL_URL;
  throw new HttpError(503, 'Billing management is not configured yet. Email security@raptorlabs.dev to change or cancel a plan.');
}

export interface CheckoutSessionShape {
  id: string;
  mode: string | null;
  status: string | null;
  clientReferenceId: string | null;
  customer: string | null;
  email: string | null;
  metadata: Record<string, unknown>;
  subscription: SubscriptionShape | null;
  subscriptionId: string | null;
}

export function parseCheckoutSession(raw: unknown): CheckoutSessionShape | null {
  const s = raw as {
    id?: unknown; mode?: unknown; status?: unknown; client_reference_id?: unknown; customer?: unknown; metadata?: unknown;
    customer_details?: { email?: unknown }; customer_email?: unknown; subscription?: unknown;
  } | null;
  if (!s || typeof s.id !== 'string') return null;
  const customer = typeof s.customer === 'string' ? s.customer : ((s.customer as { id?: unknown } | null)?.id as string | undefined) ?? null;
  const sub = typeof s.subscription === 'object' && s.subscription ? parseSubscription(s.subscription) : null;
  return {
    id: s.id,
    mode: typeof s.mode === 'string' ? s.mode : null,
    status: typeof s.status === 'string' ? s.status : null,
    clientReferenceId: typeof s.client_reference_id === 'string' ? s.client_reference_id : null,
    customer,
    email: typeof s.customer_details?.email === 'string' ? s.customer_details.email : typeof s.customer_email === 'string' ? s.customer_email : null,
    metadata: (s.metadata && typeof s.metadata === 'object' ? s.metadata : {}) as Record<string, unknown>,
    subscription: sub,
    subscriptionId: sub?.id ?? (typeof s.subscription === 'string' ? s.subscription : null),
  };
}

export async function retrieveCheckoutSession(env: AppEnv, id: string, fetchImpl?: typeof fetch): Promise<CheckoutSessionShape | null> {
  if (!env.STRIPE_SECRET_KEY || !/^cs_[A-Za-z0-9_]+$/.test(id)) return null;
  const raw = await stripe<unknown>(env.STRIPE_SECRET_KEY, 'GET', `/v1/checkout/sessions/${id}`, { expand: ['subscription'] }, fetchImpl);
  return parseCheckoutSession(raw);
}

export async function retrieveSubscription(env: AppEnv, id: string, fetchImpl?: typeof fetch): Promise<SubscriptionShape | null> {
  if (!env.STRIPE_SECRET_KEY) return null;
  return parseSubscription(await stripe<unknown>(env.STRIPE_SECRET_KEY, 'GET', `/v1/subscriptions/${id}`, {}, fetchImpl));
}

/** Move an existing subscription to the other plan's price, prorated. */
export async function switchPlan(env: AppEnv, subscriptionId: string, plan: PaidPlan, fetchImpl?: typeof fetch): Promise<SubscriptionShape | null> {
  const price = priceFor(env, plan);
  if (!env.STRIPE_SECRET_KEY || !price) throw new HttpError(503, 'Plan changes need billing management: cancel the current plan, then subscribe to the new one.');
  const current = await stripe<{ items?: { data?: { id?: string }[] } }>(env.STRIPE_SECRET_KEY, 'GET', `/v1/subscriptions/${subscriptionId}`, {}, fetchImpl);
  const itemId = current.items?.data?.[0]?.id;
  if (!itemId) throw new HttpError(502, 'The subscription has no items');
  const updated = await stripe<unknown>(env.STRIPE_SECRET_KEY, 'POST', `/v1/subscriptions/${subscriptionId}`, {
    items: [{ id: itemId, price }],
    proration_behavior: 'create_prorations',
    metadata: { plan, app: APP_TAG },
  }, fetchImpl);
  return parseSubscription(updated);
}

/** Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>]; HMAC-SHA256 over "<t>.<payload>". */
export async function verifyStripeSignature(payload: string, header: string | null, secret: string, now = Date.now(), toleranceSec = 300): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !/^\d+$/.test(t) || !sigs.length) return false;
  if (Math.abs(now / 1000 - Number(t)) > toleranceSec) return false;
  const expected = Array.from(await hmacSha256(secret, `${t}.${payload}`), (b) => b.toString(16).padStart(2, '0')).join('');
  const enc = new TextEncoder();
  return sigs.some((s) => timingSafeEqual(enc.encode(s), enc.encode(expected)));
}

/** Test helper and local tooling: build a Stripe-Signature header for a payload. */
export async function signStripePayload(payload: string, secret: string, now = Date.now()): Promise<string> {
  const t = Math.floor(now / 1000);
  const v1 = Array.from(await hmacSha256(secret, `${t}.${payload}`), (b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${t},v1=${v1}`;
}
