export const dynamic = 'force-dynamic';

const TYPES = /^image\/(png|jpe?g|webp|gif|avif|svg\+xml)$/;
const MAX_BYTES = 2_000_000;

/**
 * GET /api/img?u=<https url>: token logo proxy. Logos live on arbitrary IPFS
 * and CDN hosts; loading them directly leaks every visitor's IP to whoever
 * launched the token, and some gateways send a same-origin CORP header that
 * browsers block. Only image types are passed through, SVG is served inert
 * (sandboxed, no scripts), and responses are edge-cached for a day.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('u') ?? '';
  let target: URL;
  try {
    target = new URL(raw.startsWith('ipfs://') ? `https://ipfs.filebase.io/ipfs/${raw.slice(7)}` : raw);
  } catch {
    return new Response('Bad url', { status: 400 });
  }
  if (target.protocol !== 'https:') return new Response('https only', { status: 400 });
  try {
    const res = await fetch(target.href, {
      headers: { Accept: 'image/*' },
      signal: AbortSignal.timeout(8000),
      cf: { cacheTtl: 86_400, cacheEverything: true },
    } as RequestInit);
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!res.ok || !TYPES.test(type)) return new Response('Not an image', { status: 415 });
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_BYTES) return new Response('Too large', { status: 413 });
    const body = await res.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return new Response('Too large', { status: 413 });
    return new Response(body, {
      headers: {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch {
    return new Response('Upstream failed', { status: 502 });
  }
}
