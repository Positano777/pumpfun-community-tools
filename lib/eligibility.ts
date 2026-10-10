/**
 * A real wallet for the free tier. A keypair costs nothing to make, so a
 * free allowance keyed by wallet alone is keyed by nothing. A wallet that
 * holds at least FREE_WALLET_MIN_SOL and has signed at least
 * FREE_WALLET_MIN_TXS transactions costs SOL and time to manufacture in
 * bulk, which is the point: the allowance follows wallets that look like a
 * person's, and every other sign-in shares the network address's allowance.
 * The answer is cached for a day when the wallet qualifies and for an hour
 * when it does not, so a wallet funded today qualifies within the hour.
 */
import type { AppEnv } from './env';
import { scanContext } from './service';

export const DEFAULT_MIN_SOL = 0.01;
export const DEFAULT_MIN_TXS = 5;

export interface EligibilityRpc {
  call<T = unknown>(method: string, params?: unknown[]): Promise<T>;
}

export interface Eligibility {
  eligible: boolean;
  reason: 'funded-and-used' | 'unfunded' | 'unused' | 'unknown';
  balanceSol: number | null;
  txs: number | null;
}

export function minSol(env: AppEnv): number {
  const n = Number(env.FREE_WALLET_MIN_SOL);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MIN_SOL;
}

export function minTxs(env: AppEnv): number {
  const n = Number(env.FREE_WALLET_MIN_TXS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_MIN_TXS;
}

/** Two cheap reads: the balance and the newest few signatures. */
export async function checkWallet(rpc: EligibilityRpc, wallet: string, needSol: number, needTxs: number): Promise<Eligibility> {
  try {
    const [bal, sigs] = await Promise.all([
      rpc.call<{ value: number }>('getBalance', [wallet, { commitment: 'confirmed' }]),
      needTxs > 0 ? rpc.call<unknown[]>('getSignaturesForAddress', [wallet, { limit: Math.min(needTxs, 50) }]) : Promise.resolve([] as unknown[]),
    ]);
    const balanceSol = Number(bal?.value ?? 0) / 1e9;
    const txs = Array.isArray(sigs) ? sigs.length : 0;
    if (balanceSol < needSol) return { eligible: false, reason: 'unfunded', balanceSol, txs };
    if (txs < needTxs) return { eligible: false, reason: 'unused', balanceSol, txs };
    return { eligible: true, reason: 'funded-and-used', balanceSol, txs };
  } catch {
    return { eligible: false, reason: 'unknown', balanceSol: null, txs: null };
  }
}

export async function walletEligibility(env: AppEnv, wallet: string, rpc?: EligibilityRpc): Promise<Eligibility> {
  const key = `eligible:v1:${wallet}`;
  const hit = env.CACHE ? ((await env.CACHE.get(key, 'json').catch(() => null)) as Eligibility | null) : null;
  if (hit) return hit;
  const result = await checkWallet(rpc ?? scanContext(env).rpc, wallet, minSol(env), minTxs(env));
  if (result.reason !== 'unknown') await env.CACHE?.put(key, JSON.stringify(result), { expirationTtl: result.eligible ? 86_400 : 3_600 }).catch(() => undefined);
  return result;
}
