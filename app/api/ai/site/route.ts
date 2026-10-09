import { getEnv } from '@/lib/env';
import { publicSiteReview, reviewSite, type SiteReview } from '@/lib/ai/site';
import { fail, json, originAllowed } from '@/lib/http';
import { paidOnly, resolveAccess } from '@/lib/access';

export const dynamic = 'force-dynamic';

/** POST /api/ai/site { url }: render a token website with Browser Run and review it for drainer lures. */
export async function POST(req: Request) {
  if (!originAllowed(req)) return json({ error: 'Forbidden' }, { status: 403 });
  try {
    const body = (await req.json().catch(() => ({}))) as { url?: unknown };
    const raw = typeof body.url === 'string' ? body.url.trim() : '';
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return json({ error: 'A valid https URL is required.' }, { status: 400 });
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return json({ error: 'Only http(s) URLs.' }, { status: 400 });
    const { env } = await getEnv();
    paidOnly(await resolveAccess(req, env), 'Website forensics');
    const key = `site:review:v1:${url.href}`;
    const hit = env.CACHE ? ((await env.CACHE.get(key, 'json').catch(() => null)) as SiteReview | null) : null;
    if (hit) return json({ review: publicSiteReview(hit), cached: true });
    const review = await reviewSite(env.BROWSER, env.AI, env.REPORTS, env.AI_GATEWAY_ID, url.href);
    if (review.verdict !== 'unreachable') await env.CACHE?.put(key, JSON.stringify(review), { expirationTtl: 3600 }).catch(() => undefined);
    return json({ review: publicSiteReview(review), cached: false });
  } catch (e) {
    return fail(e);
  }
}
