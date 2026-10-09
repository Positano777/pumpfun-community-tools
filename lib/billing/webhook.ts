import type { AppEnv } from '../env';
import { isAddress } from '../solana/address';
import { accountByCustomer, ensureAccount, patchFromStripe, recordEvent, subscriptionById, upsertSubscription } from '../account';
import { APP_TAG, parseCheckoutSession, parseSubscription, planForPrice, planFromMetadata, retrieveSubscription, type CheckoutSessionShape, type PaidPlan } from './stripe';

/**
 * Stripe webhook fulfilment. The Stripe account hosts other RaptorLabs
 * products, so every event is first checked to be RugHawk's: our price ids,
 * or metadata.app = "rughawk" (set on Checkout Sessions and Payment Links).
 * Events are applied once (ledger in D1) and in any order: a subscription
 * created by a Payment Link is stored with an empty wallet until
 * checkout.session.completed attributes it.
 */

export interface StripeEvent {
  id: string;
  type: string;
  livemode: boolean;
  object: unknown;
}

export function parseEvent(raw: unknown): StripeEvent | null {
  const e = raw as { id?: unknown; type?: unknown; livemode?: unknown; data?: { object?: unknown } } | null;
  if (!e || typeof e.id !== 'string' || typeof e.type !== 'string' || !e.data || e.data.object === undefined) return null;
  return { id: e.id, type: e.type, livemode: e.livemode === true, object: e.data.object };
}

export function pickWallet(ref: string | null, metadata: Record<string, unknown>): string | null {
  if (ref && isAddress(ref)) return ref;
  const w = metadata.wallet;
  return typeof w === 'string' && isAddress(w) ? w : null;
}

function ours(metadata: Record<string, unknown>): boolean {
  return metadata.app === APP_TAG;
}

/** Apply one event; returns a short label of what happened (for logs and tests). */
export async function applyStripeEvent(env: AppEnv, event: StripeEvent, fetchImpl?: typeof fetch): Promise<string> {
  if (!(await recordEvent(env.DB, event.id, event.type))) return 'duplicate';
  switch (event.type) {
    case 'checkout.session.completed':
      return onCheckoutCompleted(env, event.object, fetchImpl);
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return onSubscription(env, event.object);
    case 'invoice.payment_failed':
      return onInvoiceFailed(env, event.object);
    default:
      return 'ignored';
  }
}

/** Shared by the webhook and the post-checkout sync (which has the session expanded). */
export async function recordCheckout(env: AppEnv, s: CheckoutSessionShape, fetchImpl?: typeof fetch): Promise<string> {
  if (s.mode !== 'subscription') return 'skipped';
  const wallet = pickWallet(s.clientReferenceId, s.metadata);
  if (!wallet) return 'no-wallet';
  const existing = s.subscriptionId ? await subscriptionById(env.DB, s.subscriptionId) : null;
  if (!ours(s.metadata) && !existing) return 'foreign';
  let sub = s.subscription;
  if (!sub && s.subscriptionId) sub = await retrieveSubscription(env, s.subscriptionId, fetchImpl).catch(() => null);
  const plan: PaidPlan | null = planFromMetadata(s.metadata) ?? (sub ? planForPrice(env, sub.priceId) ?? planFromMetadata(sub.metadata) : null) ?? existing?.plan ?? null;
  await ensureAccount(env.DB, wallet, { email: s.email, stripeCustomer: s.customer });
  if (s.subscriptionId) {
    await upsertSubscription(
      env.DB,
      s.subscriptionId,
      sub ? patchFromStripe(sub, plan, wallet) : { wallet, plan, status: existing?.status ?? 'active', customer: s.customer },
    );
  }
  return 'checkout';
}

async function onCheckoutCompleted(env: AppEnv, raw: unknown, fetchImpl?: typeof fetch): Promise<string> {
  const s = parseCheckoutSession(raw);
  return s ? recordCheckout(env, s, fetchImpl) : 'skipped';
}

async function onSubscription(env: AppEnv, raw: unknown): Promise<string> {
  const sub = parseSubscription(raw);
  if (!sub) return 'skipped';
  const existing = await subscriptionById(env.DB, sub.id);
  const byPrice = planForPrice(env, sub.priceId);
  if (!byPrice && !ours(sub.metadata) && !existing) return 'foreign';
  let wallet = pickWallet(null, sub.metadata) ?? (existing?.wallet || null);
  if (!wallet && sub.customer) wallet = (await accountByCustomer(env.DB, sub.customer))?.wallet ?? null;
  const plan = byPrice ?? planFromMetadata(sub.metadata) ?? existing?.plan ?? null;
  await upsertSubscription(env.DB, sub.id, patchFromStripe(sub, plan, wallet));
  if (wallet && sub.customer) await ensureAccount(env.DB, wallet, { stripeCustomer: sub.customer });
  return wallet ? 'subscription' : 'subscription-unattributed';
}

async function onInvoiceFailed(env: AppEnv, raw: unknown): Promise<string> {
  const inv = raw as { subscription?: unknown; parent?: { subscription_details?: { subscription?: unknown } } } | null;
  const ref = inv?.subscription ?? inv?.parent?.subscription_details?.subscription;
  const id = typeof ref === 'string' ? ref : (ref as { id?: unknown } | null)?.id;
  if (typeof id !== 'string') return 'skipped';
  const existing = await subscriptionById(env.DB, id);
  if (!existing) return 'foreign';
  await upsertSubscription(env.DB, id, { status: 'past_due' });
  return 'past-due';
}
