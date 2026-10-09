import { getEnv } from '@/lib/env';
import { issueNonce, signInMessage } from '@/lib/auth';
import { appUrl } from '@/lib/billing/stripe';
import { isAddress } from '@/lib/solana/address';
import { fail, json, originAllowed } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** POST /api/auth/nonce { wallet }: the sign-in message this wallet must sign (valid 5 minutes). */
export async function POST(req: Request) {
  if (!originAllowed(req)) return json({ error: 'Forbidden' }, { status: 403 });
  try {
    const { wallet } = (await req.json().catch(() => ({}))) as { wallet?: unknown };
    if (!isAddress(wallet)) return json({ error: 'Invalid wallet address' }, { status: 400 });
    const { env } = await getEnv();
    if (!env.SESSION_SECRET) return json({ error: 'Sign-in is not configured on this deployment.' }, { status: 503 });
    const { nonce, issuedAt } = await issueNonce(env.CACHE, wallet);
    return json({ message: signInMessage(wallet, nonce, issuedAt, new URL(appUrl(env)).hostname) });
  } catch (e) {
    return fail(e);
  }
}
