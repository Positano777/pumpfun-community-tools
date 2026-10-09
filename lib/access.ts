import type { AppEnv } from './env';
import { HttpError } from './errors';
import { sessionWallet } from './auth';
import { apiKeyByValue, consume, dayPeriod, entitlement, monthPeriod, touchApiKey, API_KEY_PREFIX } from './account';
import type { Plan } from './billing/stripe';

/**
 * Who is calling and what they may do. Three doors:
 *  - API key (Authorization: Bearer rh_live_...): the API plan, metered monthly.
 *  - Session cookie: a signed-in wallet with whatever plan it bought.
 *  - Nobody: the free tier, metered per IP per day on engine runs.
 */
export interface Access {
  wallet: string | null;
  plan: Plan;
  via: 'apikey' | 'session' | 'anon';
  keyHash: string | null;
  ip: string;
}

export const DEFAULT_FREE_SCANS_PER_DAY = 25;
export const DEFAULT_API_CALLS_PER_MONTH = 50_000;

export function freeScansPerDay(env: AppEnv): number {
  const n = Number(env.FREE_SCANS_PER_DAY);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FREE_SCANS_PER_DAY;
}

export function apiCallsPerMonth(env: AppEnv): number {
  const n = Number(env.API_CALLS_PER_MONTH);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_API_CALLS_PER_MONTH;
}

export function bearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization') ?? '';
  const m = auth.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

export function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip') ?? 'local';
}

export async function resolveAccess(req: Request, env: AppEnv): Promise<Access> {
  const ip = clientIp(req);
  const token = bearerToken(req);
  if (token && token.startsWith(API_KEY_PREFIX)) {
    const key = await apiKeyByValue(env.DB, token);
    if (!key) throw new HttpError(401, 'Invalid API key.');
    const ent = await entitlement(env.DB, key.wallet);
    if (ent.plan !== 'api') throw new HttpError(402, 'The API subscription behind this key is not active.', { upgrade: '/account' });
    return { wallet: key.wallet, plan: 'api', via: 'apikey', keyHash: key.hash, ip };
  }
  const wallet = await sessionWallet(req, env);
  if (wallet) {
    const ent = await entitlement(env.DB, wallet);
    return { wallet, plan: ent.plan, via: 'session', keyHash: null, ip };
  }
  return { wallet: null, plan: 'free', via: 'anon', keyHash: null, ip };
}

/** Every API-key request counts against the monthly quota, cached or not. */
export async function chargeApiCall(env: AppEnv, access: Access): Promise<{ used: number; limit: number } | null> {
  if (access.via !== 'apikey' || !access.keyHash) return null;
  const limit = apiCallsPerMonth(env);
  const c = await consume(env.DB, `key:${access.keyHash}`, monthPeriod(), limit);
  if (!c.allowed) throw new HttpError(429, `Monthly API quota of ${limit.toLocaleString('en-US')} calls reached. It resets on the first of next month.`, { used: c.used, limit });
  touchApiKey(env.DB, access.keyHash).catch(() => undefined);
  return { used: c.used, limit };
}

/**
 * A gate the scan service runs just before the engine (never on cache
 * hits). Free visitors get FREE_SCANS_PER_DAY engine runs per IP per day;
 * Pro, API and key holders are not metered here.
 */
export function scanGate(env: AppEnv, access: Access): (() => Promise<void>) | undefined {
  if (access.plan !== 'free') return undefined;
  const limit = freeScansPerDay(env);
  return async () => {
    const c = await consume(env.DB, `ip:${access.ip}`, dayPeriod(), limit);
    if (!c.allowed) {
      throw new HttpError(402, `Daily limit reached: ${limit} free scans a day. Go Pro for unlimited scans.`, { upgrade: '/#pricing', used: c.used, limit });
    }
  };
}

export function paidOnly(access: Access, feature: string): void {
  if (access.plan === 'free') throw new HttpError(402, `${feature} is a Pro feature. Go Pro to unlock it.`, { upgrade: '/#pricing' });
}
