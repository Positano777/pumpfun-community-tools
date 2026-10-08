import { getEnv } from '@/lib/env';
import { marketPulse } from '@/lib/ai/pulse';
import { fail, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** GET /api/ai/pulse: the last 24 hours of flagged launches, counted by the engine and phrased by Predator AI (cached 10 minutes). */
export async function GET() {
  try {
    const { env } = await getEnv();
    return json(await marketPulse(env), { cache: 60 });
  } catch (e) {
    return fail(e);
  }
}
