import { getEnv } from '@/lib/env';
import { base64ToBytes, sessionCookie, signInMessage, signSession, takeNonce, verifyWalletSignature } from '@/lib/auth';
import { ensureAccount, entitlement } from '@/lib/account';
import { appUrl } from '@/lib/billing/stripe';
import { isAddress } from '@/lib/solana/address';
import { fail, json, originAllowed } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** POST /api/auth/verify { wallet, signature (base64) }: checks the signed nonce and sets the session cookie. */
export async function POST(req: Request) {
  if (!originAllowed(req)) return json({ error: 'Forbidden' }, { status: 403 });
  try {
    const body = (await req.json().catch(() => ({}))) as { wallet?: unknown; signature?: unknown };
    const wallet = body.wallet;
    if (!isAddress(wallet) || typeof body.signature !== 'string') return json({ error: 'Wallet and signature are required' }, { status: 400 });
    const { env } = await getEnv();
    if (!env.SESSION_SECRET) return json({ error: 'Sign-in is not configured on this deployment.' }, { status: 503 });
    const nonce = await takeNonce(env.CACHE, wallet);
    if (!nonce) return json({ error: 'The sign-in request expired. Try again.' }, { status: 400 });
    let signature: Uint8Array;
    try {
      signature = base64ToBytes(body.signature);
    } catch {
      return json({ error: 'Malformed signature' }, { status: 400 });
    }
    const message = signInMessage(wallet, nonce.nonce, nonce.issuedAt, new URL(appUrl(env)).hostname);
    if (!(await verifyWalletSignature(wallet, message, signature))) return json({ error: 'Signature does not match this wallet.' }, { status: 401 });
    await ensureAccount(env.DB, wallet).catch(() => undefined);
    const ent = await entitlement(env.DB, wallet).catch(() => ({ plan: 'free' as const }));
    const res = json({ wallet, plan: ent.plan });
    res.headers.append('Set-Cookie', sessionCookie(await signSession(env.SESSION_SECRET, wallet)));
    return res;
  } catch (e) {
    return fail(e);
  }
}
