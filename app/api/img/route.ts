import { afterResponse, getEnv } from '@/lib/env';
import { loadLogo, logoCandidates } from '@/lib/logo';

export const dynamic = 'force-dynamic';

/**
 * GET /api/img?u=<https or ipfs url>: token logo proxy. Logos live on
 * arbitrary IPFS and CDN hosts; loading them directly leaks every visitor's
 * IP to whoever launched the token, and some gateways send a same-origin
 * CORP header that browsers block. IPFS content is fetched through a list
 * of dependable gateways (the one the metadata names is usually throttled),
 * kept in KV for a week, and served edge-cached for a day. Only image types
 * pass through, and SVG is served inert (sandboxed, no scripts).
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('u') ?? '';
  if (raw.length > 2048 || logoCandidates(raw).length === 0) return text('Bad url', 400);
  const { env, ctx } = await getEnv();
  const logo = await loadLogo(raw, env.CACHE ?? null, (work) => void afterResponse(ctx, work));
  if (!logo) return text('Logo unavailable', 404);
  return new Response(logo.bytes, {
    headers: {
      'Content-Type': logo.type,
      'Content-Length': String(logo.bytes.byteLength),
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}

function text(body: string, status: number) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
}
