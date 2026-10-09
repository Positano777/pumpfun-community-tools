import type { KVLike } from './env';
import { gatewayUrls, ipfsRef } from './ipfs';

/**
 * Token logo retrieval behind /api/img. A logo URL from token metadata is
 * expanded into an ordered list of gateways and fetched until one answers
 * with an image; the bytes are then kept in KV for a week so a logo fetched
 * once is served from every edge location, even while every public IPFS
 * gateway is throttling.
 */

export const LOGO_MAX_BYTES = 4_000_000;
/** Largest logo kept in KV; bigger ones are fetched through the edge cache each time. */
const KV_MAX_BYTES = 1_000_000;
const KV_TTL = 7 * 86_400;
/** How long a logo that no gateway could serve stays marked as missing. */
const MISS_TTL = 600;
const TYPES = /^image\/(png|jpe?g|webp|gif|avif|svg\+xml)$/;
/** Content types some gateways put on images; the bytes decide. */
const GENERIC = new Set(['', 'application/octet-stream', 'binary/octet-stream']);
/** A dedicated gateway that resizes on request: 256 px instead of multi-megabyte originals. */
const RESIZING_HOST = 'pump.mypinata.cloud';

export interface Logo {
  bytes: ArrayBuffer;
  type: string;
}

export interface LogoOptions {
  fetch?: typeof fetch;
  /** Timeout per gateway attempt. */
  attemptMs?: number;
  /** Total time across all attempts. */
  budgetMs?: number;
  now?: () => number;
}

/** Image type from the first bytes, for gateways that mislabel content. */
export function sniffImageType(bytes: ArrayBuffer): string | null {
  const b = new Uint8Array(bytes, 0, Math.min(16, bytes.byteLength));
  const at = (i: number, ...want: number[]) => want.every((w, k) => b[i + k] === w);
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (b.length >= 6 && at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  if (b.length >= 12 && at(4, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69)) return 'image/avif';
  return null;
}

/**
 * Ordered https URLs to try for a logo. IPFS content goes to the resizing
 * gateway first, then the dependable gateways, then whatever the metadata
 * named if it is a throttled public gateway.
 */
export function logoCandidates(url: string): string[] {
  const urls = gatewayUrls(url).filter((u) => u.startsWith('https://'));
  const r = ipfsRef(url);
  if (!r) return urls;
  const resized = `https://${RESIZING_HOST}/ipfs/${r.cid}${r.path}?img-width=256&img-dpr=1&img-onerror=redirect`;
  return [resized, ...urls.filter((u) => !u.startsWith(`https://${RESIZING_HOST}/`))];
}

/** Fetch the logo from the first candidate that answers with an image. */
export async function fetchLogo(url: string, opts: LogoOptions = {}): Promise<Logo | null> {
  const f = opts.fetch ?? fetch;
  const attemptMs = opts.attemptMs ?? 4500;
  const budgetMs = opts.budgetMs ?? 12_000;
  const now = opts.now ?? Date.now;
  const start = now();
  for (const candidate of logoCandidates(url)) {
    const left = budgetMs - (now() - start);
    if (left < 500) break;
    try {
      const res = await f(candidate, {
        headers: { Accept: 'image/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(Math.min(attemptMs, left)),
        cf: { cacheTtl: 86_400, cacheEverything: true },
      } as RequestInit);
      if (!res.ok) continue;
      const declared = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!TYPES.test(declared) && !GENERIC.has(declared)) continue;
      if (Number(res.headers.get('content-length') ?? 0) > LOGO_MAX_BYTES) continue;
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength === 0 || bytes.byteLength > LOGO_MAX_BYTES) continue;
      const type = sniffImageType(bytes) ?? (TYPES.test(declared) ? declared : null);
      if (type) return { bytes, type };
    } catch {
      // next gateway
    }
  }
  return null;
}

/** One KV key per logo, shared by every gateway URL that names the same content. */
export async function logoKey(url: string): Promise<string> {
  const r = ipfsRef(url);
  const id = r ? `ipfs:${r.cid}${r.path}` : `url:${url.trim()}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `logo:v1:${hex}`;
}

interface LogoMeta {
  type?: string;
  miss?: boolean;
}

/**
 * The logo from KV when present, otherwise from the gateways, remembering
 * the result either way. `defer` keeps the KV write alive past the response.
 */
export async function loadLogo(url: string, kv: KVLike | null, defer: (work: Promise<unknown>) => void, opts: LogoOptions = {}): Promise<Logo | null> {
  const key = await logoKey(url);
  if (kv?.getWithMetadata) {
    const hit = await kv.getWithMetadata(key, 'arrayBuffer').catch(() => null);
    const meta = (hit?.metadata ?? null) as LogoMeta | null;
    if (hit?.value && hit.value.byteLength > 0 && meta?.type) return { bytes: hit.value, type: meta.type };
    if (meta?.miss) return null;
  }
  const logo = await fetchLogo(url, opts);
  if (kv) {
    if (logo && logo.bytes.byteLength <= KV_MAX_BYTES) {
      defer(kv.put(key, logo.bytes, { expirationTtl: KV_TTL, metadata: { type: logo.type } }).catch(() => undefined));
    } else if (!logo) {
      defer(kv.put(key, '', { expirationTtl: MISS_TTL, metadata: { miss: true } }).catch(() => undefined));
    }
  }
  return logo;
}
