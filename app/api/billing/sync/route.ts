import { getEnv } from '@/lib/env';
import { resolveAccess } from '@/lib/access';
import { entitlement } from '@/lib/account';
import { retrieveCheckoutSession } from '@/lib/billing/stripe';
import { pickWallet, recordCheckout } from '@/lib/billing/webhook';
import { fail, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/billing/sync?session_id=cs_...: right after checkout, read the
 * session from Stripe (when the secret key is configured) so the plan is
 * live before the webhook lands. Returns the wallet's current plan.
 */
export async function GET(req: Request) {
  try {
    const { env } = await getEnv();
    const access = await resolveAccess(req, env);
    if (!access.wallet || access.via !== 'session') return json({ error: 'Sign in with your wallet first.' }, { status: 401 });
    const id = new URL(req.url).searchParams.get('session_id') ?? '';
    let synced = false;
    if (id) {
      const s = await retrieveCheckoutSession(env, id).catch(() => null);
      if (s && pickWallet(s.clientReferenceId, s.metadata) === access.wallet) synced = (await recordCheckout(env, s)) === 'checkout';
    }
    const ent = await entitlement(env.DB, access.wallet);
    return json({ synced, plan: ent.plan });
  } catch (e) {
    return fail(e);
  }
}
