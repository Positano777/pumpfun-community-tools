import { getEnv } from '@/lib/env';
import { tokenReport } from '@/lib/service';
import { fail, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** GET /api/scan/token?mint=<mint>[&fresh=1] */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mint = url.searchParams.get('mint')?.trim() ?? '';
  try {
    const { env, ctx } = await getEnv();
    return json(await tokenReport(env, ctx, mint, url.searchParams.get('fresh') === '1'));
  } catch (e) {
    return fail(e);
  }
}
