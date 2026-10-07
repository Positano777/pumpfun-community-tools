import { getEnv } from '@/lib/env';
import { tokenReport, walletReport } from '@/lib/service';
import { aiVerdict } from '@/lib/ai/verdict';
import { fail, json } from '@/lib/http';
import type { AiVerdict } from '@/lib/scan/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ai/verdict?kind=token|wallet&address=<address>
 * The plain-English verdict, generated after the report so the deterministic
 * evidence renders first. Cached per (address, score) for 15 minutes.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get('kind') === 'wallet' ? 'wallet' : 'token';
  const address = url.searchParams.get('address')?.trim() ?? '';
  try {
    const { env, ctx } = await getEnv();
    const report = kind === 'token' ? await tokenReport(env, ctx, address) : await walletReport(env, ctx, address);
    const key = `verdict:v1:${kind}:${address}:${report.risk.score}`;
    const hit = env.CACHE ? ((await env.CACHE.get(key, 'json').catch(() => null)) as AiVerdict | null) : null;
    if (hit) return json({ verdict: hit, cached: true });
    const verdict = await aiVerdict(env.AI, env.AI_GATEWAY_ID, report);
    if (!verdict) return json({ verdict: null, error: 'AI verdict unavailable right now. The evidence below is complete without it.' });
    await env.CACHE?.put(key, JSON.stringify(verdict), { expirationTtl: 900 }).catch(() => undefined);
    return json({ verdict, cached: false });
  } catch (e) {
    return fail(e);
  }
}
