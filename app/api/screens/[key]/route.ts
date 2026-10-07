import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

/** GET /api/screens/<hash>.png: Browser Run screenshots stored as evidence in R2. */
export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  if (!/^[a-f0-9]{32}\.png$/.test(key)) return new Response('Not found', { status: 404 });
  const { env } = await getEnv();
  const obj = await env.REPORTS?.get(`screens/${key}`);
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'Content-Security-Policy': "default-src 'none'; sandbox" },
  });
}
