/**
 * IPFS addressing for token logos and metadata documents.
 *
 * Token metadata almost always names one public path gateway (ipfs.io for
 * every pump.fun launch), and those gateways throttle shared egress such as
 * Workers: measured 2026-10-09, ipfs.io, dweb.link and gateway.pinata.cloud
 * answered 429 on every logo in the feed. Content addressing makes the
 * gateway interchangeable, so every IPFS reference is resolved through a
 * list of dependable gateways, with the throttled public ones kept only as
 * a last resort.
 */

/** Gateways in preference order, measured for reliability and latency. */
export const IPFS_GATEWAYS = [
  'https://ipfs.filebase.io/ipfs/',
  'https://pump.mypinata.cloud/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
];

/** Public path gateways that rate-limit shared egress; never tried first. */
const THROTTLED = new Set([
  'ipfs.io',
  'gateway.ipfs.io',
  'dweb.link',
  'gateway.pinata.cloud',
  'w3s.link',
  'nftstorage.link',
  'cloudflare-ipfs.com',
  'cf-ipfs.com',
  '4everland.io',
]);

/** CIDv0 (base58, 46 chars) or CIDv1 (base32 "b", base36 "k", base58 "z"). */
const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|[bB][A-Za-z2-7]{50,}|[kK][a-z0-9]{50,}|z[1-9A-HJ-NP-Za-km-z]{40,})$/;

export interface IpfsRef {
  cid: string;
  /** Path below the CID, starting with "/", or "" for the root. */
  path: string;
}

/** The content id behind an ipfs:// URI, a path gateway URL or a subdomain gateway URL. */
export function ipfsRef(uri: string): IpfsRef | null {
  const u = uri.trim();
  if (/^ipfs:\/\//i.test(u)) return split(u.slice(7).replace(/^ipfs\//, ''));
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const path = url.pathname.match(/^\/ipfs\/([^/]+)(\/.*)?$/);
  if (path) return ref(path[1], path[2] ?? '');
  const sub = url.hostname.match(/^([A-Za-z0-9]+)\.ipfs\./);
  if (sub) return ref(sub[1], url.pathname === '/' ? '' : url.pathname);
  return null;
}

function split(rest: string): IpfsRef | null {
  const clean = rest.split(/[?#]/)[0];
  const slash = clean.indexOf('/');
  return slash < 0 ? ref(clean, '') : ref(clean.slice(0, slash), clean.slice(slash));
}

function ref(cid: string, path: string): IpfsRef | null {
  return CID.test(cid) ? { cid, path: path.replace(/\/+$/, '') } : null;
}

/**
 * URLs to try for a metadata URI, in order. IPFS content gets the gateway
 * list; the URL the metadata named stays first unless it points at a
 * throttled public gateway, in which case it becomes the last resort.
 */
export function gatewayUrls(uri: string): string[] {
  const u = uri.trim();
  const r = ipfsRef(u);
  if (r) {
    const fallbacks = IPFS_GATEWAYS.map((g) => g + r.cid + r.path);
    const original = /^https?:\/\//i.test(u) ? [u] : [];
    const host = original.length ? new URL(u).hostname : '';
    const ordered = THROTTLED.has(host) ? [...fallbacks, ...original] : [...original, ...fallbacks];
    return ordered.filter((v, i, a) => a.indexOf(v) === i);
  }
  if (/^ar:\/\//i.test(u)) return [`https://arweave.net/${u.slice(5)}`];
  if (/^https?:\/\//i.test(u)) return [u];
  return [];
}
