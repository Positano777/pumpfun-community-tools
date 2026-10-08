import { getEnv } from '@/lib/env';
import { tokenReport, walletReport } from '@/lib/service';
import { aiVerdict, publicVerdict } from '@/lib/ai/verdict';
import { isLanguage, translateVerdict } from '@/lib/ai/translate';
import { fail, json, originAllowed } from '@/lib/http';
import type { AiVerdict, PublicAiVerdict } from '@/lib/scan/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ai/translate { kind, address, score, lang }: the verdict of a
 * report in another language. Reads the cached English verdict (or makes
 * it), translates every field and caches the result for a day.
 */
export async function POST(req: Request) {
  if (!originAllowed(req)) return json({ error: 'Forbidden' }, { status: 403 });
  try {
    const body = (await req.json().catch(() => ({}))) as { kind?: unknown; address?: unknown; score?: unknown; lang?: unknown };
    const kind = body.kind === 'wallet' ? 'wallet' : 'token';
    const address = typeof body.address === 'string' ? body.address.trim() : '';
    const score = Number(body.score);
    if (!isLanguage(body.lang)) return json({ error: 'Unsupported language.' }, { status: 400 });
    if (!address || !Number.isFinite(score)) return json({ error: 'kind, address and score are required.' }, { status: 400 });
    const { env, ctx } = await getEnv();
    if (!env.AI) return json({ error: 'Translation unavailable right now.' }, { status: 503 });
    const lang = body.lang;
    const cacheKey = `verdict:v1:${kind}:${address}:${score}:${lang}`;
    const cached = env.CACHE ? ((await env.CACHE.get(cacheKey, 'json').catch(() => null)) as PublicAiVerdict | null) : null;
    if (cached) return json({ verdict: cached, lang, cached: true });

    const englishKey = `verdict:v1:${kind}:${address}:${score}`;
    let english = env.CACHE ? ((await env.CACHE.get(englishKey, 'json').catch(() => null)) as AiVerdict | null) : null;
    if (!english) {
      const report = kind === 'token' ? await tokenReport(env, ctx, address) : await walletReport(env, ctx, address);
      english = await aiVerdict(env.AI, env.AI_GATEWAY_ID, report);
      if (!english) return json({ error: 'The verdict is not ready yet.' }, { status: 503 });
      await env.CACHE?.put(`verdict:v1:${kind}:${address}:${report.risk.score}`, JSON.stringify(english), { expirationTtl: 900 }).catch(() => undefined);
    }
    const verdict = await translateVerdict(env.AI, env.AI_GATEWAY_ID, publicVerdict(english), lang);
    await env.CACHE?.put(cacheKey, JSON.stringify(verdict), { expirationTtl: 86_400 }).catch(() => undefined);
    return json({ verdict, lang, cached: false });
  } catch (e) {
    return fail(e);
  }
}
