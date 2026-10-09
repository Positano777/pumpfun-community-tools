import { getEnv } from '@/lib/env';
import { resolveAccess } from '@/lib/access';
import { account } from '@/lib/account';
import { portalUrl } from '@/lib/billing/stripe';
import { fail, json, originAllowed } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** POST /api/billing/portal: where a signed-in wallet manages or cancels its subscription. */
export async function POST(req: Request) {
  if (!originAllowed(req)) return json({ error: 'Forbidden' }, { status: 403 });
  try {
    const { env } = await getEnv();
    const access = await resolveAccess(req, env);
    if (!access.wallet || access.via !== 'session') return json({ error: 'Sign in with your wallet first.' }, { status: 401 });
    const acct = await account(env.DB, access.wallet);
    return json({ url: await portalUrl(env, acct?.stripe_customer ?? null) });
  } catch (e) {
    return fail(e);
  }
}
