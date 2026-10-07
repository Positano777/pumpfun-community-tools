import { getEnv } from '@/lib/env';
import { walletReport } from '@/lib/service';
import { fail, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** GET /api/scan/wallet?address=<address>[&fresh=1] */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = url.searchParams.get('address')?.trim() ?? '';
  try {
    const { env, ctx } = await getEnv();
    return json(await walletReport(env, ctx, address, url.searchParams.get('fresh') === '1'));
  } catch (e) {
    return fail(e);
  }
}
