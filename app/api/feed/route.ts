import { getEnv } from '@/lib/env';
import { feed, stats } from '@/lib/db';
import { fail, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** GET /api/feed[?grade=risky]: latest scans and platform totals (D1). */
export async function GET(req: Request) {
  const grade = new URL(req.url).searchParams.get('grade') === 'risky' ? 'risky' : 'all';
  try {
    const { env } = await getEnv();
    const [rows, totals] = await Promise.all([feed(env.DB, { grade, limit: 24 }), stats(env.DB)]);
    return json({ rows, stats: totals }, { cache: 20 });
  } catch (e) {
    return fail(e);
  }
}
