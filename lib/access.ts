import type { AppEnv } from './env';
import { HttpError } from './errors';
import { sessionWallet } from './auth';
import { apiKeyByValue, consume, dayPeriod, entitlement, monthPeriod, touchApiKey, API_KEY_PREFIX } from './account';
import type { Plan } from './billing/stripe';
import { walletEligibility, type EligibilityRpc } from './eligibility';

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
/** Site renders and logo checks a free visitor gets per day (Browser Run plus vision calls cost real money). */
export const DEFAULT_FREE_DEEP_CHECKS_PER_DAY = 3;

export function freeScansPerDay(env: AppEnv): number {
  const n = Number(env.FREE_SCANS_PER_DAY);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FREE_SCANS_PER_DAY;
}

export function apiCallsPerMonth(env: AppEnv): number {
  const n = Number(env.API_CALLS_PER_MONTH);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_API_CALLS_PER_MONTH;
}

export function freeDeepChecksPerDay(env: AppEnv): number {
  const n = Number(env.FREE_DEEP_CHECKS_PER_DAY);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_FREE_DEEP_CHECKS_PER_DAY;
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
 * Who a free allowance belongs to.
 *
 * A signed-in wallet that is funded and used (lib/eligibility.ts) gets its
 * own allowance: it costs SOL and history to manufacture, and it keeps a
 * trader on a shared mobile or office address from being throttled by their
 * neighbours. Everyone else, anonymous or signed in with a fresh keypair,
 * shares the network address's allowance, so a thousand empty wallets from
 * one address are worth exactly one address. A second counter caps every
 * free run from an address whichever wallets sign in from it, so cycling
 * funded wallets through one connection runs out too.
 */
export interface FreeIdentity {
  key: string;
  identity: 'wallet' | 'ip';
}

export async function freeIdentity(env: AppEnv, access: Access, rpc?: EligibilityRpc): Promise<FreeIdentity> {
  if (access.wallet && access.via === 'session') {
    const e = await walletEligibility(env, access.wallet, rpc);
    if (e.eligible) return { key: `wallet:${access.wallet}`, identity: 'wallet' };
  }
  return { key: `ip:${access.ip}`, identity: 'ip' };
}

/** Free engine runs an address may make in a day across every wallet that signs in from it. */
export const IP_CEILING_FACTOR = 4;

/**
 * A gate the scan service runs just before the engine (never on cache
 * hits). Free visitors get FREE_SCANS_PER_DAY engine runs per identity per
 * day (see freeIdentity); Pro, API and key holders are not metered here.
 */
export function scanGate(env: AppEnv, access: Access, rpc?: EligibilityRpc): (() => Promise<void>) | undefined {
  if (access.plan !== 'free') return undefined;
  const limit = freeScansPerDay(env);
  return async () => {
    const id = await freeIdentity(env, access, rpc);
    const day = dayPeriod();
    // The identity's own allowance first: a run it refuses never touches the address ceiling.
    const c = await consume(env.DB, id.key, day, limit);
    if (!c.allowed) {
      throw new HttpError(402, `Daily limit reached: ${limit} free scans a day. Go Pro for unlimited scans.`, { upgrade: '/#pricing', used: c.used, limit });
    }
    if (id.identity === 'wallet') {
      const ceiling = await consume(env.DB, `ipall:${access.ip}`, day, limit * IP_CEILING_FACTOR);
      if (!ceiling.allowed) {
        throw new HttpError(402, `This network address has used its free engine runs for today. Go Pro for unlimited scans.`, { upgrade: '/#pricing', used: ceiling.used, limit: ceiling.limit });
      }
    }
  };
}

export function paidOnly(access: Access, feature: string): void {
  if (access.plan === 'free') throw new HttpError(402, `${feature} is a Pro feature. Go Pro to unlock it.`, { upgrade: '/#pricing' });
}

/** Free deep checks an address may run in a day across every wallet that signs in from it. */
export const DEEP_IP_CEILING_FACTOR = 3;

/**
 * Deep checks (site render, logo vision) for free visitors: a few a day per
 * identity so anyone can see what they do; Pro and API wallets are not
 * metered. They need a signed-in wallet (the wallet is the account, and the
 * sign-in is the first step of the upgrade), and the allowance follows the
 * wallet only when it is funded and used; otherwise it is the address's.
 * Runs after the cache lookup, so a repeat of a cached check costs nothing.
 */
export async function deepCheckGate(env: AppEnv, access: Access, feature: string, rpc?: EligibilityRpc): Promise<void> {
  if (access.plan !== 'free') return;
  const limit = freeDeepChecksPerDay(env);
  if (limit <= 0) return paidOnly(access, feature);
  if (!access.wallet || access.via !== 'session') {
    throw new HttpError(401, `Sign in with your wallet to run ${limit} free deep checks a day. Pro wallets run them without limit.`, { signIn: true, upgrade: '/#pricing', limit });
  }
  const id = await freeIdentity(env, access, rpc);
  const day = dayPeriod();
  const c = await consume(env.DB, `deep:${id.key}`, day, limit);
  if (!c.allowed) {
    const why =
      id.identity === 'wallet'
        ? `your ${limit} free deep checks for today are used.`
        : `this wallet is new or unfunded, so it shares the ${limit} free deep checks a day of your network address, and they are used. A wallet holding 0.01 SOL with 5 transactions gets its own allowance.`;
    throw new HttpError(402, `${feature}: ${why} Go Pro for unlimited site and logo forensics.`, { upgrade: '/#pricing', used: c.used, limit, identity: id.identity });
  }
  // Then the address ceiling, which cycling funded wallets through one connection runs into.
  const ceiling = await consume(env.DB, `deep:ipall:${access.ip}`, day, limit * DEEP_IP_CEILING_FACTOR);
  if (!ceiling.allowed) {
    throw new HttpError(402, `${feature}: this network address has used its free deep checks for today. Go Pro for unlimited site and logo forensics.`, { upgrade: '/#pricing', used: ceiling.used, limit: ceiling.limit });
  }
}
