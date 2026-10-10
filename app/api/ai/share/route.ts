import { getEnv } from '@/lib/env';
import { tokenReport, walletReport } from '@/lib/service';
import { sharePost } from '@/lib/ai/share';
import { fail, json, originAllowed } from '@/lib/http';
import { isAddress } from '@/lib/solana/address';

export const dynamic = 'force-dynamic';

/** POST /api/ai/share { kind, address }: a warning post for X and Telegram written from the scan (cached per score). */
export async function POST(req: Request) {
  if (!originAllowed(req)) return json({ error: 'Forbidden' }, { status: 403 });
  try {
    const body = (await req.json().catch(() => ({}))) as { kind?: unknown; address?: unknown };
    const kind = body.kind === 'wallet' ? 'wallet' : 'token';
    const address = typeof body.address === 'string' ? body.address.trim() : '';
    if (!isAddress(address)) return json({ error: 'Invalid Solana address' }, { status: 400 });
    const { env, ctx } = await getEnv();
    const report = kind === 'token' ? await tokenReport(env, ctx, address) : await walletReport(env, ctx, address);
    return json(await sharePost(env, report));
  } catch (e) {
    return fail(e);
  }
}
