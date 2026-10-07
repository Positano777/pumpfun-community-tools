import { SolanaRpc } from '../rpc';

/**
 * Minimal cache contract, satisfied by Workers KV in production and by an
 * in-memory map in the CLI and tests. Values are JSON.
 */
export interface JsonCache {
  get<T>(key: string): Promise<T | null>;
  put(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

/** Previously flagged scans, looked up by deployer (D1 in production). */
export interface ScanHistory {
  flaggedByDeployer(deployer: string, excludeAddress: string): Promise<{ address: string; symbol: string | null; risk: number }[]>;
}

export interface ScanContext {
  rpc: SolanaRpc;
  cache: JsonCache;
  history?: ScanHistory;
  /** Outbound HTTP for DexScreener, metadata JSON, RDAP, website fetches. */
  fetch: typeof fetch;
  now: () => number;
  log?: (msg: string) => void;
}

export class MemoryCache implements JsonCache {
  private store = new Map<string, { value: unknown; expires: number }>();
  async get<T>(key: string): Promise<T | null> {
    const hit = this.store.get(key);
    if (!hit || hit.expires < Date.now()) return null;
    return hit.value as T;
  }
  async put(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
  }
}

/** Read-through cache helper; failures to cache never fail the scan. */
export async function cached<T>(ctx: ScanContext, key: string, ttlSeconds: number, produce: () => Promise<T>): Promise<T> {
  try {
    const hit = await ctx.cache.get<T>(key);
    if (hit !== null && hit !== undefined) return hit;
  } catch {
    // cache miss on error
  }
  const value = await produce();
  try {
    if (value !== null && value !== undefined) await ctx.cache.put(key, value, ttlSeconds);
  } catch {
    // ignore cache write failures
  }
  return value;
}

/** Run a module, recording a partial-result marker instead of failing the scan. */
export async function guarded<T>(partial: string[], name: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    partial.push(`${name}: ${e instanceof Error ? e.message.slice(0, 120) : 'failed'}`);
    return fallback;
  }
}

export const UA = 'Mozilla/5.0 (compatible; RugHawk/0.1; +https://rughawk.com)';

export async function fetchJson<T>(ctx: ScanContext, url: string, timeoutMs = 6000, maxBytes = 512_000): Promise<T | null> {
  const res = await ctx.fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return null;
  const text = await readCapped(res, maxBytes);
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Read a response body up to maxBytes; never buffers an unbounded download. */
export async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.byteLength;
  }
  try {
    await reader.cancel();
  } catch {
    // already closed
  }
  const merged = new Uint8Array(Math.min(total, maxBytes));
  let o = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, merged.length - o);
    merged.set(c.subarray(0, take), o);
    o += take;
    if (o >= merged.length) break;
  }
  return new TextDecoder().decode(merged);
}
