import { getEnv } from '@/lib/env';
import { MAX_QUERY, normaliseQuery, searchDna } from '@/lib/ai/memory';
import { fail, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** GET /api/ai/memory?q=<words>: the Scam DNA index searched in plain words (embedding + Vectorize), cached 5 minutes per query. */
export async function GET(req: Request) {
  const q = normaliseQuery(new URL(req.url).searchParams.get('q'));
  if (q.length < 2) return json({ error: `Describe the token in 2 to ${MAX_QUERY} characters.` }, { status: 400 });
  try {
    const { env } = await getEnv();
    const { hits, available } = await searchDna(env, q);
    return json({ query: q, hits, available }, { cache: 60 });
  } catch (e) {
    return fail(e);
  }
}
