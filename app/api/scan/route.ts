import { getEnv } from '@/lib/env';
import { anyReport } from '@/lib/service';
import { chargeApiCall, resolveAccess, scanGate } from '@/lib/access';
import { fail, json, withQuota } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** GET /api/scan?address=<any Solana address>: token report for mints, wallet report otherwise. */
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get('address')?.trim() ?? '';
  try {
    const { env, ctx } = await getEnv();
    const access = await resolveAccess(req, env);
    const quota = await chargeApiCall(env, access);
    const report = await anyReport(env, ctx, address, scanGate(env, access));
    return withQuota(json({ kind: report.kind, report }), quota);
  } catch (e) {
    return fail(e);
  }
}
