import { getEnv } from '@/lib/env';
import { resolveAccess } from '@/lib/access';
import { account, entitlement, patchFromStripe, upsertSubscription } from '@/lib/account';
import { billingMode, checkoutUrl, isPaidPlan, switchPlan } from '@/lib/billing/stripe';
import { fail, json, originAllowed } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * POST /api/billing/checkout { plan: 'pro' | 'api' }: where to send a
 * signed-in wallet to pay. A wallet already on a paid plan is moved to the
 * other price on its existing subscription (prorated) when the secret key
 * is configured; otherwise it is pointed at billing management.
 */
export async function POST(req: Request) {
  if (!originAllowed(req)) return json({ error: 'Forbidden' }, { status: 403 });
  try {
    const { plan } = (await req.json().catch(() => ({}))) as { plan?: unknown };
    if (!isPaidPlan(plan)) return json({ error: 'Choose the Pro or the API plan.' }, { status: 400 });
    const { env } = await getEnv();
    const access = await resolveAccess(req, env);
    if (!access.wallet || access.via !== 'session') return json({ error: 'Sign in with your wallet first.' }, { status: 401 });
    const ent = await entitlement(env.DB, access.wallet);
    if (ent.plan === plan) return json({ error: `You are already on the ${plan === 'pro' ? 'Pro' : 'API'} plan.`, manage: '/account' }, { status: 409 });
    if (ent.subscription) {
      if (billingMode(env) === 'checkout') {
        const sub = await switchPlan(env, ent.subscription.id, plan);
        if (sub) await upsertSubscription(env.DB, sub.id, patchFromStripe(sub, plan, access.wallet));
        return json({ switched: true, url: '/account?checkout=switched' });
      }
      return json({ error: 'Change plans from billing management: cancel the current plan, then subscribe to the new one.', manage: '/account' }, { status: 409 });
    }
    const acct = await account(env.DB, access.wallet);
    const url = await checkoutUrl(env, { wallet: access.wallet, plan, customer: acct?.stripe_customer ?? null, email: acct?.email ?? null });
    return json({ url });
  } catch (e) {
    return fail(e);
  }
}
