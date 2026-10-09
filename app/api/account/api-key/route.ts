import { getEnv } from '@/lib/env';
import { resolveAccess } from '@/lib/access';
import { issueApiKey, revokeApiKeys } from '@/lib/account';
import { fail, json, originAllowed } from '@/lib/http';

export const dynamic = 'force-dynamic';

async function apiPlanWallet(req: Request) {
  const { env } = await getEnv();
  const access = await resolveAccess(req, env);
  if (!access.wallet || access.via !== 'session') return { env, error: json({ error: 'Sign in with your wallet first.' }, { status: 401 }) };
  if (access.plan !== 'api') return { env, error: json({ error: 'API keys come with the API plan.', upgrade: '/#pricing' }, { status: 402 }) };
  return { env, wallet: access.wallet };
}

/** POST /api/account/api-key: issue a new key (revokes the previous one). The key is shown once. */
export async function POST(req: Request) {
  if (!originAllowed(req)) return json({ error: 'Forbidden' }, { status: 403 });
  try {
    const r = await apiPlanWallet(req);
    if (r.error) return r.error;
    return json(await issueApiKey(r.env.DB, r.wallet!));
  } catch (e) {
    return fail(e);
  }
}

/** DELETE /api/account/api-key: revoke the active key. */
export async function DELETE(req: Request) {
  if (!originAllowed(req)) return json({ error: 'Forbidden' }, { status: 403 });
  try {
    const r = await apiPlanWallet(req);
    if (r.error) return r.error;
    await revokeApiKeys(r.env.DB, r.wallet!);
    return json({ revoked: true });
  } catch (e) {
    return fail(e);
  }
}
