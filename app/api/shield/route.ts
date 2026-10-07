import { getEnv } from '@/lib/env';
import { shieldReport } from '@/lib/service';
import { fail, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** GET /api/shield?owner=<wallet>: approvals, frozen accounts, seizable tokens, reclaimable rent. */
export async function GET(req: Request) {
  const owner = new URL(req.url).searchParams.get('owner')?.trim() ?? '';
  try {
    const { env } = await getEnv();
    return json(await shieldReport(env, owner));
  } catch (e) {
    return fail(e);
  }
}
