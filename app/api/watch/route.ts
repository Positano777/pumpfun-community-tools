import { getEnv } from '@/lib/env';
import { addWatch, alertsFor } from '@/lib/db';
import { addWatchSub, removeWatchSub } from '@/lib/account';
import { resolveAccess, scanGate } from '@/lib/access';
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

/**
 * POST /api/watch { address }: add a token to the Watchtower (re-scanned
 * every 10 minutes). A signed-in Pro or API wallet is also subscribed, so
 * alerts reach its account page, Telegram and webhook.
 */
export async function POST(req: Request) {
  if (!originAllowed(req)) return json({ error: 'Forbidden' }, { status: 403 });
  try {
    const { address } = (await req.json().catch(() => ({}))) as { address?: string };
    if (!isAddress(address)) return json({ error: 'Invalid Solana address' }, { status: 400 });
    const { env, ctx } = await getEnv();
    const access = await resolveAccess(req, env);
    const r = await tokenReport(env, ctx, address, false, scanGate(env, access));
    const label = r.token.symbol ?? r.token.name;
    await addWatch(env.DB, address, 'token', label, r.risk.score, r.risk.grade, r.market?.totalLiquidityUsd ?? null);
    let subscribed = false;
    if (access.wallet && access.plan !== 'free') {
      await addWatchSub(env.DB, access.wallet, address, label);
      subscribed = true;
    }
    return json({ watching: true, subscribed, plan: access.plan, signedIn: Boolean(access.wallet) });
  } catch (e) {
    return fail(e);
  }
}

/** DELETE /api/watch?address=: drop the signed-in wallet's subscription to a token. */
export async function DELETE(req: Request) {
  if (!originAllowed(req)) return json({ error: 'Forbidden' }, { status: 403 });
  try {
    const address = new URL(req.url).searchParams.get('address')?.trim() ?? '';
    if (!isAddress(address)) return json({ error: 'Invalid Solana address' }, { status: 400 });
    const { env } = await getEnv();
    const access = await resolveAccess(req, env);
    if (!access.wallet || access.via !== 'session') return json({ error: 'Sign in with your wallet first.' }, { status: 401 });
    await removeWatchSub(env.DB, access.wallet, address);
    return json({ watching: false });
  } catch (e) {
    return fail(e);
  }
}
