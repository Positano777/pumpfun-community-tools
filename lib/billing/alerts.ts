import type { AppEnv, KVLike } from '../env';
import { bindTelegram, subscribersFor, type AccountRow } from '../account';
import { hmacSha256 } from '../auth';

/**
 * Watchtower alert delivery for paid plans: Telegram (Pro and API) and
 * signed webhooks (API). The cron computes alerts; this module only sends
 * them, each attempt bounded by a short timeout so one dead endpoint cannot
 * stall the run.
 */

export interface AlertMessage {
  severity: string;
  message: string;
}

const TIMEOUT_MS = 5000;

export function telegramEnabled(env: AppEnv): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_NAME);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function sendTelegram(token: string, chatId: string, html: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Only https URLs to a named host: no IP literals, no localhost. */
export function validWebhookUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password) return false;
    const h = u.hostname;
    return h.includes('.') && !/^[\d.]+$/.test(h) && !h.startsWith('[') && !h.endsWith('.local') && h !== 'localhost';
  } catch {
    return false;
  }
}

export interface WebhookPayload {
  event: 'watchtower.alert';
  address: string;
  label: string | null;
  alerts: AlertMessage[];
  url: string;
  sentAt: string;
}

/** POST the payload with a Stripe-style signature: X-RugHawk-Signature: t=<unix>,v1=<hmac hex>. */
export async function postWebhook(url: string, secret: string | null, payload: WebhookPayload, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<boolean> {
  const body = JSON.stringify(payload);
  const t = Math.floor(now / 1000);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'RugHawk-Watchtower/1.0', 'X-RugHawk-Event': payload.event };
  if (secret) {
    const v1 = Array.from(await hmacSha256(secret, `${t}.${body}`), (b) => b.toString(16).padStart(2, '0')).join('');
    headers['X-RugHawk-Signature'] = `t=${t},v1=${v1}`;
  }
  try {
    const res = await fetchImpl(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

export function alertHtml(address: string, label: string | null, alerts: AlertMessage[], base: string): string {
  const name = escapeHtml(label ? `$${label}` : `${address.slice(0, 4)}…${address.slice(-4)}`);
  const lines = alerts.map((a) => `${a.severity === 'critical' ? '🔴' : '🟠'} <b>${escapeHtml(a.severity.toUpperCase())}</b> ${escapeHtml(a.message)}`);
  return [`🦅 <b>RugHawk Watchtower</b> · ${name}`, ...lines, `<a href="${base}/token/${address}">Open the report</a>`].join('\n');
}

/** Deliver alerts for an address to every subscribed account; returns deliveries made. */
export async function deliverAlerts(env: AppEnv, address: string, label: string | null, alerts: AlertMessage[], fetchImpl: typeof fetch = fetch): Promise<number> {
  if (!alerts.length) return 0;
  const subs = await subscribersFor(env.DB, address).catch(() => [] as AccountRow[]);
  if (!subs.length) return 0;
  const base = (env.NEXT_PUBLIC_APP_URL ?? 'https://rughawk.xyz').replace(/\/$/, '');
  const html = alertHtml(address, label, alerts, base);
  const payload: WebhookPayload = { event: 'watchtower.alert', address, label, alerts, url: `${base}/token/${address}`, sentAt: new Date().toISOString() };
  let sent = 0;
  await Promise.all(
    subs.map(async (a) => {
      if (a.telegram_chat && env.TELEGRAM_BOT_TOKEN && (await sendTelegram(env.TELEGRAM_BOT_TOKEN, a.telegram_chat, html, fetchImpl))) sent++;
      if (a.webhook_url && validWebhookUrl(a.webhook_url) && (await postWebhook(a.webhook_url, a.webhook_secret, payload, fetchImpl))) sent++;
    }),
  );
  return sent;
}

interface TelegramUpdate {
  update_id: number;
  message?: { text?: string; chat?: { id?: number | string } };
}

/**
 * Link Telegram chats: the account page hands out t.me/<bot>?start=<code>;
 * the bot receives "/start <code>" and this poll binds the chat to the
 * wallet that generated the code. Long polling is not needed: the cron
 * runs every 10 minutes and the offset lives in KV.
 */
export async function pollTelegram(env: AppEnv, fetchImpl: typeof fetch = fetch): Promise<number> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return 0;
  const kv: KVLike | undefined = env.CACHE;
  const offset = kv ? Number((await kv.get('tg:offset', 'json').catch(() => 0)) ?? 0) : 0;
  let linked = 0;
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&limit=50&allowed_updates=%5B%22message%22%5D`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: TelegramUpdate[] };
    const updates = data.ok && Array.isArray(data.result) ? data.result : [];
    let last = offset;
    for (const u of updates) {
      last = Math.max(last, u.update_id + 1);
      const text = u.message?.text ?? '';
      const chat = u.message?.chat?.id;
      const code = text.match(/^\/start\s+([0-9A-Za-z]{10,40})/)?.[1];
      if (!code || chat === undefined) continue;
      const wallet = await bindTelegram(env.DB, code, String(chat));
      if (wallet) {
        linked++;
        await sendTelegram(token, String(chat), `🦅 <b>RugHawk Watchtower connected</b> for ${escapeHtml(wallet.slice(0, 4))}…${escapeHtml(wallet.slice(-4))}. Alerts for your watched tokens arrive here.`, fetchImpl);
      } else {
        await sendTelegram(token, String(chat), 'This link has expired. Open your RugHawk account page and press Connect Telegram again.', fetchImpl);
      }
    }
    if (kv && last !== offset) await kv.put('tg:offset', JSON.stringify(last), { expirationTtl: 30 * 86_400 }).catch(() => undefined);
  } catch (e) {
    console.warn('[watchtower] telegram poll failed', e instanceof Error ? e.message : e);
  }
  return linked;
}
