/**
 * The one place request handlers, the copilot and the cron share: builds the
 * scan context from Cloudflare bindings and serves reports through the KV
 * cache, persisting history (D1), Scam DNA (Vectorize) and snapshots (R2)
 * after the response.
 */
import type { AppEnv, ExecutionCtx, KVLike } from './env';
import { afterResponse } from './env';
import { SolanaRpc, rpcUpstreams } from './rpc';
import { MemoryCache, type JsonCache, type ScanContext } from './scan/context';
import { NotAMintError, scanToken } from './scan/token';
import { scanWallet } from './scan/wallet';
import { loadShield, type ShieldReport } from './scan/shield';
import type { TokenReport, WalletReport } from './scan/types';
import { d1History, recordScan } from './db';
import { dnaMatches, rememberDna } from './ai/dna';
import { isAddress } from './solana/address';

export const REPORT_TTL = 120;

class KvCache implements JsonCache {
  constructor(private kv: KVLike) {}
  async get<T>(key: string): Promise<T | null> {
    return ((await this.kv.get(key, 'json')) as T | null) ?? null;
  }
  async put(key: string, value: unknown, ttl: number): Promise<void> {
    await this.kv.put(key, JSON.stringify(value), { expirationTtl: Math.max(60, ttl) });
  }
}

const memory = new MemoryCache();

export function scanContext(env: AppEnv): ScanContext {
  return {
    rpc: new SolanaRpc(rpcUpstreams(env)),
    cache: env.CACHE ? new KvCache(env.CACHE) : memory,
    history: d1History(env.DB),
    fetch: (...args) => fetch(...args),
    now: () => Date.now(),
  };
}

export type Resolved = { kind: 'token' } | { kind: 'wallet' };

/** Mint addresses get the token report; everything else the wallet report. */
export async function resolveKind(ctx: ScanContext, address: string): Promise<Resolved['kind']> {
  const res = await ctx.rpc.call<{ value: { owner: string; data: { parsed?: { type?: string } } | unknown } | null }>('getAccountInfo', [
    address,
    { encoding: 'jsonParsed' },
  ]);
  const data = res.value?.data as { parsed?: { type?: string } } | undefined;
  return data?.parsed?.type === 'mint' ? 'token' : 'wallet';
}

export async function tokenReport(env: AppEnv, cfctx: ExecutionCtx | null, mint: string, fresh = false): Promise<TokenReport> {
  if (!isAddress(mint)) throw new Error('Invalid Solana address');
  const ctx = scanContext(env);
  const key = `report:token:v1:${mint}`;
  if (!fresh) {
    const hit = await ctx.cache.get<TokenReport>(key).catch(() => null);
    if (hit) return hit;
  }
  const report = await scanToken(ctx, mint);
  const gw = env.AI_GATEWAY_ID;
  const { matches, vector } = await dnaMatches(env.AI, env.DNA, gw, report).catch(() => ({ matches: [], vector: null }));
  report.dna = matches;
  if (matches.length) {
    report.findings.unshift({
      id: 'SCAM_DNA_MATCH',
      severity: 'high',
      category: 'intel',
      title: `Identity matches ${matches.length} token${matches.length > 1 ? 's' : ''} RugHawk already flagged`,
      detail: 'Name, ticker, description and links are near-identical (vector similarity) to earlier HIGH or CRITICAL tokens. Same narrative, new mint: the copy-paste signature of a serial operation.',
      weight: 20,
      evidence: matches.slice(0, 3).map((m) => ({ label: `${m.symbol ?? m.address.slice(0, 6)} (risk ${m.risk})`, value: `${Math.round(m.similarity * 100)}% similar`, href: `/token/${m.address}` })),
    });
    const { scoreFindings, sortFindings } = await import('./scan/score');
    report.findings = sortFindings(report.findings);
    report.risk = scoreFindings(report.findings);
  }
  await ctx.cache.put(key, report, REPORT_TTL).catch(() => undefined);
  afterResponse(cfctx, persist(env, report, vector));
  return report;
}

export async function walletReport(env: AppEnv, cfctx: ExecutionCtx | null, address: string, fresh = false): Promise<WalletReport> {
  if (!isAddress(address)) throw new Error('Invalid Solana address');
  const ctx = scanContext(env);
  const key = `report:wallet:v1:${address}`;
  if (!fresh) {
    const hit = await ctx.cache.get<WalletReport>(key).catch(() => null);
    if (hit) return hit;
  }
  const report = await scanWallet(ctx, address);
  await ctx.cache.put(key, report, REPORT_TTL).catch(() => undefined);
  afterResponse(cfctx, recordScan(env.DB, report));
  return report;
}

export async function anyReport(env: AppEnv, cfctx: ExecutionCtx | null, address: string): Promise<TokenReport | WalletReport> {
  if (!isAddress(address)) throw new Error('Invalid Solana address');
  const ctx = scanContext(env);
  const kind = await resolveKind(ctx, address);
  if (kind === 'token') {
    try {
      return await tokenReport(env, cfctx, address);
    } catch (e) {
      if (!(e instanceof NotAMintError)) throw e;
    }
  }
  return walletReport(env, cfctx, address);
}

export async function shieldReport(env: AppEnv, owner: string): Promise<ShieldReport> {
  if (!isAddress(owner)) throw new Error('Invalid Solana address');
  return loadShield(scanContext(env), owner);
}

async function persist(env: AppEnv, report: TokenReport, vector: number[] | null): Promise<void> {
  await Promise.all([
    recordScan(env.DB, report),
    rememberDna(env.DNA, report, vector),
    env.REPORTS?.put(`reports/token/${report.mint}/${report.scannedAt}.json`, JSON.stringify(report), { httpMetadata: { contentType: 'application/json' } }),
  ]);
}
