import { getEnv } from '@/lib/env';
import { anyReport } from '@/lib/service';
import { fail, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** GET /api/scan?address=<any Solana address>: token report for mints, wallet report otherwise. */
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get('address')?.trim() ?? '';
  try {
    const { env, ctx } = await getEnv();
    const report = await anyReport(env, ctx, address);
    return json({ kind: report.kind, report });
  } catch (e) {
    return fail(e);
  }
}
