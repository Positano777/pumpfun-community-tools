import { getEnv } from '@/lib/env';
import { tokenReport } from '@/lib/service';
import { chargeApiCall, resolveAccess, scanGate } from '@/lib/access';
import { fail, json, withQuota } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** GET /api/scan/token?mint=<mint>[&fresh=1]; API keys as Authorization: Bearer rh_live_... */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mint = url.searchParams.get('mint')?.trim() ?? '';
  try {
    const { env, ctx } = await getEnv();
    const access = await resolveAccess(req, env);
    const quota = await chargeApiCall(env, access);
    const report = await tokenReport(env, ctx, mint, url.searchParams.get('fresh') === '1', scanGate(env, access));
    return withQuota(json(report), quota);
  } catch (e) {
    return fail(e);
  }
}
