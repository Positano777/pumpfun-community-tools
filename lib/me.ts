import type { AppEnv } from './env';
import type { Access } from './access';
import { apiCallsPerMonth, freeScansPerDay } from './access';
import { account, activeApiKey, alertsForWallet, entitlement, monthPeriod, usage, watchSubsFor, type AlertRow, type WatchRow } from './account';
import { billingMode, type Plan } from './billing/stripe';
import { telegramEnabled } from './billing/alerts';

/** What the account page and the pricing buttons know about the caller. */
export interface Me {
  wallet: string | null;
  plan: Plan;
  subscription: { status: string; periodEnd: number | null; cancelAtPeriodEnd: boolean } | null;
  billing: { mode: 'checkout' | 'links' | 'off'; portal: boolean };
  limits: { freeScansPerDay: number; apiCallsPerMonth: number };
  apiKey: { prefix: string; createdAt: number; lastUsed: number | null; used: number; limit: number } | null;
  webhook: { url: string; secret: string | null } | null;
  telegram: { enabled: boolean; connected: boolean; bot: string | null };
  watches: WatchRow[];
  alerts: AlertRow[];
}

export async function buildMe(env: AppEnv, access: Access): Promise<Me> {
  const limits = { freeScansPerDay: freeScansPerDay(env), apiCallsPerMonth: apiCallsPerMonth(env) };
  const mode = billingMode(env);
  const base: Me = {
    wallet: null,
    plan: 'free',
    subscription: null,
    billing: { mode, portal: false },
    limits,
    apiKey: null,
    webhook: null,
    telegram: { enabled: telegramEnabled(env), connected: false, bot: env.TELEGRAM_BOT_NAME ?? null },
    watches: [],
    alerts: [],
  };
  if (!access.wallet) return base;
  const wallet = access.wallet;
  const [ent, acct, key, watches, alerts] = await Promise.all([
    entitlement(env.DB, wallet),
    account(env.DB, wallet),
    activeApiKey(env.DB, wallet),
    watchSubsFor(env.DB, wallet).catch(() => []),
    alertsForWallet(env.DB, wallet).catch(() => []),
  ]);
  const used = key ? await usage(env.DB, `key:${key.hash}`, monthPeriod()).catch(() => 0) : 0;
  return {
    ...base,
    wallet,
    plan: ent.plan,
    subscription: ent.subscription
      ? { status: ent.subscription.status, periodEnd: ent.subscription.period_end, cancelAtPeriodEnd: ent.subscription.cancel_at_period_end === 1 }
      : null,
    billing: { mode, portal: Boolean((env.STRIPE_SECRET_KEY && acct?.stripe_customer) || env.STRIPE_PORTAL_URL) },
    apiKey: key && ent.plan === 'api' ? { prefix: key.prefix, createdAt: key.created_at, lastUsed: key.last_used, used, limit: limits.apiCallsPerMonth } : null,
    webhook: acct?.webhook_url ? { url: acct.webhook_url, secret: acct.webhook_secret } : null,
    telegram: { ...base.telegram, connected: Boolean(acct?.telegram_chat) },
    watches,
    alerts,
  };
}
