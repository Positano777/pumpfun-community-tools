import { getEnv } from '@/lib/env';
import { tokenReport } from '@/lib/service';
import { publicLogoReview, reviewLogo, type LogoReview } from '@/lib/ai/vision';
import { BLUE_CHIPS } from '@/lib/solana/known';
import { fail, json } from '@/lib/http';
import { deepCheckGate, resolveAccess } from '@/lib/access';

export const dynamic = 'force-dynamic';

/** GET /api/ai/logo?mint=<mint>: does the token's logo imitate a known brand? (vision review) */
export async function GET(req: Request) {
  const mint = new URL(req.url).searchParams.get('mint')?.trim() ?? '';
  try {
    const { env, ctx } = await getEnv();
    const report = await tokenReport(env, ctx, mint);
    if (!report.token.image) return json({ review: null, reason: 'No logo on record.' });
    const key = `logo:v1:${mint}`;
    const hit = env.CACHE ? ((await env.CACHE.get(key, 'json').catch(() => null)) as LogoReview | null) : null;
    if (!hit) await deepCheckGate(env, await resolveAccess(req, env), 'Logo forensics');
    const review = hit ?? (await reviewLogo(env.AI, env.AI_GATEWAY_ID, report.token.image, { name: report.token.name, symbol: report.token.symbol }));
    if (review && !hit) await env.CACHE?.put(key, JSON.stringify(review), { expirationTtl: 86_400 }).catch(() => undefined);
    // A logo that imitates a blue chip only matters when this is not that blue chip.
    const real = review?.brand ? Object.values(BLUE_CHIPS).find((b) => review.brand!.toLowerCase().includes(b.name.toLowerCase().split(' ')[0])) : undefined;
    const impersonation = Boolean(review?.brand && review.confidence >= 0.6 && (!real || real.mint !== mint));
    return json({ review: review ? publicLogoReview(review) : null, impersonation });
  } catch (e) {
    return fail(e);
  }
}
