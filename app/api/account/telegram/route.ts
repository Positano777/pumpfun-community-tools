import { getEnv } from '@/lib/env';
import { resolveAccess } from '@/lib/access';
import { newTelegramCode, unlinkTelegram } from '@/lib/account';
import { telegramEnabled } from '@/lib/billing/alerts';
import { fail, json, originAllowed } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** POST /api/account/telegram: a one-time deep link that binds a Telegram chat to the wallet (Pro and API). */
export async function POST(req: Request) {
  if (!originAllowed(req)) return json({ error: 'Forbidden' }, { status: 403 });
  try {
    const { env } = await getEnv();
    if (!telegramEnabled(env)) return json({ error: 'Telegram alerts are not enabled on this deployment yet.' }, { status: 503 });
    const access = await resolveAccess(req, env);
    if (!access.wallet || access.via !== 'session') return json({ error: 'Sign in with your wallet first.' }, { status: 401 });
    if (access.plan === 'free') return json({ error: 'Telegram alerts come with the Pro plan.', upgrade: '/#pricing' }, { status: 402 });
    const code = await newTelegramCode(env.DB, access.wallet);
    return json({ url: `https://t.me/${env.TELEGRAM_BOT_NAME}?start=${code}` });
  } catch (e) {
    return fail(e);
  }
}

/** DELETE /api/account/telegram: disconnect the chat. */
export async function DELETE(req: Request) {
  if (!originAllowed(req)) return json({ error: 'Forbidden' }, { status: 403 });
  try {
    const { env } = await getEnv();
    const access = await resolveAccess(req, env);
    if (!access.wallet || access.via !== 'session') return json({ error: 'Sign in with your wallet first.' }, { status: 401 });
    await unlinkTelegram(env.DB, access.wallet);
    return json({ connected: false });
  } catch (e) {
    return fail(e);
  }
}
