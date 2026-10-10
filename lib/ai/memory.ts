/**
 * Search the Scam DNA index in plain words. Every scanned token's identity
 * (name, ticker, description, links) lives in Vectorize as a bge-base
 * embedding; a query like "fake TRUMP token with a claim site" is embedded
 * with the same model and the nearest flagged identities come back with
 * their grade, so a trader can check whether a narrative has been seen
 * before without knowing a single address. Hits are joined with the scan
 * table for the logo and the top finding.
 */
import type { AppEnv } from '../env';
import { embed } from './dna';

export interface DnaHit {
  address: string;
  symbol: string | null;
  name: string | null;
  image: string | null;
  risk: number;
  grade: string;
  launchpad: string | null;
  flag: string | null;
  similarity: number;
}

export const MIN_SIMILARITY = 0.45;
export const MAX_QUERY = 200;

/** One canonical form of a query: trimmed, single-spaced, capped. */
export function normaliseQuery(q: unknown): string {
  return typeof q === 'string' ? q.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY) : '';
}

interface ScanRow {
  address: string;
  symbol: string | null;
  name: string | null;
  image: string | null;
  risk: number;
  grade: string;
  launchpad: string | null;
  top_flags: string | null;
}

/** Vectorize matches ordered by similarity, enriched from the scan rows that exist for them. */
export function mergeHits(matches: { id: string; score: number; metadata?: Record<string, unknown> }[], rows: ScanRow[], limit: number): DnaHit[] {
  const byAddress = new Map(rows.map((r) => [r.address, r]));
  return matches
    .filter((m) => m.score >= MIN_SIMILARITY)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((m) => {
      const row = byAddress.get(m.id);
      let flag: string | null = null;
      try {
        flag = (JSON.parse(row?.top_flags ?? '[]') as string[])[0] ?? null;
      } catch {
        flag = null;
      }
      return {
        address: m.id,
        symbol: row?.symbol ?? ((m.metadata?.symbol as string) || null),
        name: row?.name ?? ((m.metadata?.name as string) || null),
        image: row?.image ?? null,
        risk: row?.risk ?? Number(m.metadata?.risk ?? 0),
        grade: row?.grade ?? String(m.metadata?.grade ?? 'LOW'),
        launchpad: row?.launchpad ?? null,
        flag,
        similarity: Math.round(m.score * 1000) / 1000,
      };
    });
}

async function sha(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

export async function searchDna(env: AppEnv, query: string, limit = 8): Promise<{ hits: DnaHit[]; available: boolean }> {
  const q = normaliseQuery(query);
  if (q.length < 2 || !env.AI || !env.DNA) return { hits: [], available: Boolean(env.AI && env.DNA) };
  const key = `dna:search:v1:${await sha(q.toLowerCase())}`;
  const hit = env.CACHE ? ((await env.CACHE.get(key, 'json').catch(() => null)) as DnaHit[] | null) : null;
  if (hit) return { hits: hit, available: true };
  const vector = await embed(env.AI, env.AI_GATEWAY_ID, q);
  if (!vector) return { hits: [], available: true };
  const res = await env.DNA.query(vector, { topK: Math.min(20, Math.max(limit * 2, 8)), returnMetadata: 'all' }).catch(() => ({ matches: [] }));
  const ids = res.matches.filter((m) => m.score >= MIN_SIMILARITY).map((m) => m.id);
  let rows: ScanRow[] = [];
  if (ids.length && env.DB) {
    const marks = ids.map((_, i) => `?${i + 1}`).join(',');
    rows = await env.DB.prepare(`SELECT address, symbol, name, image, risk, grade, launchpad, top_flags FROM scans WHERE address IN (${marks})`)
      .bind(...ids)
      .all<ScanRow>()
      .then((r) => r.results)
      .catch(() => []);
  }
  const hits = mergeHits(res.matches, rows, limit);
  await env.CACHE?.put(key, JSON.stringify(hits), { expirationTtl: 300 }).catch(() => undefined);
  return { hits, available: true };
}
