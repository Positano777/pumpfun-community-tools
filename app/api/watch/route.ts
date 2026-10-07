import { getEnv } from '@/lib/env';
import { addWatch, alertsFor } from '@/lib/db';
import { tokenReport } from '@/lib/service';
import { isAddress } from '@/lib/solana/address';
import { fail, json, originAllowed } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** GET /api/watch?address=: Watchtower alerts for a token. */
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get('address')?.trim() ?? '';
  if (!isAddress(address)) return json({ error: 'Invalid Solana address' }, { status: 400 });
  const { env } = await getEnv();
  return json({ alerts: await alertsFor(env.DB, address).catch(() => []) });
}

/** POST /api/watch { address }: add a token to the Watchtower (re-scanned every 10 minutes). */
export async function POST(req: Request) {
  if (!originAllowed(req)) return json({ error: 'Forbidden' }, { status: 403 });
  try {
    const { address } = (await req.json().catch(() => ({}))) as { address?: string };
    if (!isAddress(address)) return json({ error: 'Invalid Solana address' }, { status: 400 });
    const { env, ctx } = await getEnv();
    const r = await tokenReport(env, ctx, address);
    await addWatch(env.DB, address, 'token', r.token.symbol ?? r.token.name, r.risk.score, r.risk.grade, r.market?.totalLiquidityUsd ?? null);
    return json({ watching: true });
  } catch (e) {
    return fail(e);
  }
}
