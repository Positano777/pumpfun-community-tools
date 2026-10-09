import { getEnv } from '@/lib/env';
import { resolveAccess } from '@/lib/access';
import { buildMe } from '@/lib/me';
import { fail, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** GET /api/me: the caller's wallet, plan, API key, alert channels and watchlist. */
export async function GET(req: Request) {
  try {
    const { env } = await getEnv();
    return json(await buildMe(env, await resolveAccess(req, env)));
  } catch (e) {
    return fail(e);
  }
}
