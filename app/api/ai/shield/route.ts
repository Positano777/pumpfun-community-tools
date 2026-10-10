import { getEnv } from '@/lib/env';
import { shieldReport } from '@/lib/service';
import { shieldBrief } from '@/lib/ai/shield-brief';
import { fail, json, originAllowed } from '@/lib/http';
import { isAddress } from '@/lib/solana/address';

export const dynamic = 'force-dynamic';

/** POST /api/ai/shield { owner }: the Shield report of a wallet, briefed in plain English (cached per wallet state). */
export async function POST(req: Request) {
  if (!originAllowed(req)) return json({ error: 'Forbidden' }, { status: 403 });
  try {
    const body = (await req.json().catch(() => ({}))) as { owner?: unknown };
    const owner = typeof body.owner === 'string' ? body.owner.trim() : '';
    if (!isAddress(owner)) return json({ error: 'Invalid Solana address' }, { status: 400 });
    const { env } = await getEnv();
    const report = await shieldReport(env, owner);
    return json(await shieldBrief(env, report));
  } catch (e) {
    return fail(e);
  }
}
