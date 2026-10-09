import { getEnv } from '@/lib/env';
import { resolveAccess } from '@/lib/access';
import { setWebhook } from '@/lib/account';
import { validWebhookUrl } from '@/lib/billing/alerts';
import { fail, json, originAllowed } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** PUT /api/account/webhook { url }: where Watchtower alerts are POSTed (API plan). Empty url removes it. */
export async function PUT(req: Request) {
  if (!originAllowed(req)) return json({ error: 'Forbidden' }, { status: 403 });
  try {
    const { url } = (await req.json().catch(() => ({}))) as { url?: unknown };
    const target = typeof url === 'string' ? url.trim() : '';
    if (target && (target.length > 500 || !validWebhookUrl(target))) return json({ error: 'Use an https URL on a public host.' }, { status: 400 });
    const { env } = await getEnv();
    const access = await resolveAccess(req, env);
    if (!access.wallet || access.via !== 'session') return json({ error: 'Sign in with your wallet first.' }, { status: 401 });
    if (access.plan !== 'api') return json({ error: 'Webhook alerts come with the API plan.', upgrade: '/#pricing' }, { status: 402 });
    const secret = await setWebhook(env.DB, access.wallet, target);
    return json({ url: target || null, secret });
  } catch (e) {
    return fail(e);
  }
}
