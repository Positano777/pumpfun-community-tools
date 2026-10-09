'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { currentMe, refreshMe, useAccount } from './useAccount';
import { PricingCta } from './PricingCta';
import type { Me } from '@/lib/me';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const PLAN_LABEL: Record<Me['plan'], string> = { free: 'Free', pro: 'Pro', api: 'API' };

function short(a: string): string {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

function day(ms: number | null): string {
  return ms ? new Date(ms).toISOString().slice(0, 10) : '';
}

async function post<T>(url: string, method = 'POST', body?: unknown): Promise<{ ok: boolean; data: T & { error?: string } }> {
  const r = await fetch(url, { method, headers: JSON_HEADERS, body: body === undefined ? undefined : JSON.stringify(body) });
  return { ok: r.ok, data: (await r.json().catch(() => ({}))) as T & { error?: string } };
}

export function AccountView() {
  const { me, signedIn, signIn, signOut, busy, error, mismatch, connected } = useAccount();
  const [flash, setFlash] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);

  // Back from Stripe: sync the checkout session, then wait for the webhook.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');
    if (!checkout) return;
    const sessionId = params.get('session_id') ?? '';
    window.history.replaceState({}, '', '/account');
    if (checkout === 'switched') {
      setFlash('Plan updated.');
      void refreshMe();
      return;
    }
    setActivating(true);
    let tries = 0;
    let stopped = false;
    const tick = async () => {
      tries++;
      await fetch(`/api/billing/sync?session_id=${encodeURIComponent(sessionId)}`).catch(() => undefined);
      await refreshMe();
      const plan = currentMe()?.plan ?? 'free';
      if (plan !== 'free' || tries >= 12) {
        stopped = true;
        setActivating(false);
        setFlash(plan !== 'free' ? `${PLAN_LABEL[plan]} is active. Welcome aboard.` : 'Payment received. Activation is taking longer than usual; this page refreshes on its own.');
      } else {
        setTimeout(() => {
          if (!stopped) void tick();
        }, 2500);
      }
    };
    void tick();
    return () => {
      stopped = true;
    };
  }, []);

  async function openPortal() {
    setPortalBusy(true);
    try {
      const { ok, data } = await post<{ url?: string }>('/api/billing/portal');
      if (ok && data.url) window.location.assign(data.url);
      else setFlash(data.error ?? 'Billing management is unavailable right now.');
    } finally {
      setPortalBusy(false);
    }
  }

  if (!me) return <div className="card p-6 text-sm text-muted">Loading your account...</div>;

  if (!signedIn) {
    return (
      <div className="card p-6 md:p-8">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">Sign in</div>
        <h2 className="mt-2 text-xl font-bold">Your wallet is your account</h2>
        <p className="mt-2 max-w-xl text-sm text-muted">
          You sign one message in your wallet. No transaction, no fee, nothing moves. RugHawk ties your plan, API key and Watchtower alerts to that wallet.
        </p>
        <button type="button" onClick={() => void signIn()} disabled={busy} className="btn-primary mt-5">
          {busy ? 'Check your wallet...' : connected ? 'Sign in' : 'Connect wallet and sign in'}
        </button>
        {error ? <p className="mt-3 text-xs text-signal">{error}</p> : null}
        {activating ? <p className="mt-3 text-xs text-muted">Sign in with the wallet you used at checkout to activate your plan.</p> : null}
      </div>
    );
  }

  const sub = me.subscription;
  const paid = me.plan !== 'free';

  return (
    <div className="space-y-6">
      {flash ? <div className="rounded-xl border border-signal/40 bg-signal/10 px-4 py-3 text-sm">{flash}</div> : null}
      {activating ? <div className="rounded-xl border border-graphite bg-ink/40 px-4 py-3 text-sm text-muted">Activating your plan...</div> : null}
      {mismatch ? (
        <div className="rounded-xl border border-caution/40 bg-ink/40 px-4 py-3 text-sm">
          The connected wallet differs from the signed-in wallet {short(me.wallet!)}.{' '}
          <button type="button" onClick={() => void signIn()} className="underline underline-offset-4">Sign in with the connected wallet</button>
        </div>
      ) : null}

      <div className="card p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">Plan</div>
            <div className="mt-2 flex items-center gap-3">
              <span className="text-3xl font-extrabold">{PLAN_LABEL[me.plan]}</span>
              {sub ? <span className="chip">{sub.status.replace('_', ' ')}</span> : null}
            </div>
            <div className="mt-2 text-sm text-muted">
              Wallet <span className="font-mono text-bone">{short(me.wallet!)}</span>
              {sub?.periodEnd ? (sub.cancelAtPeriodEnd ? ` · ends ${day(sub.periodEnd)}` : ` · renews ${day(sub.periodEnd)}`) : ''}
              {sub?.status === 'past_due' ? ' · payment failed, update your card' : ''}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {paid && (me.billing.portal || sub) ? (
              <button type="button" onClick={() => void openPortal()} disabled={portalBusy} className="btn-ghost">
                {portalBusy ? 'Opening...' : 'Manage billing'}
              </button>
            ) : null}
            <button type="button" onClick={() => void signOut()} className="btn-ghost">Sign out</button>
          </div>
        </div>
        {!paid ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-signal/50 bg-ink/40 p-5">
              <div className="font-bold">Pro</div>
              <div className="mt-1 text-2xl font-extrabold">$19<span className="text-sm font-normal text-muted">/month</span></div>
              <p className="mt-2 text-sm text-muted">Unlimited scans, Watchtower alerts on Telegram, deep site and logo forensics, copilot with web intel.</p>
              <PricingCta plan="pro" label="Go Pro" hot />
            </div>
            <div className="rounded-xl border border-graphite/60 bg-ink/40 p-5">
              <div className="font-bold">API</div>
              <div className="mt-1 text-2xl font-extrabold">$99<span className="text-sm font-normal text-muted">/month</span></div>
              <p className="mt-2 text-sm text-muted">50,000 scan calls a month for bots, launchpads and wallets, signed webhook alerts, everything in Pro.</p>
              <PricingCta plan="api" label="Get API access" />
            </div>
          </div>
        ) : null}
        {me.plan === 'pro' ? (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-graphite/60 bg-ink/40 p-4 text-sm">
            <span className="text-muted">Need programmatic access? The API plan adds 50,000 scan calls a month and webhook alerts.</span>
            <div className="w-full md:w-auto"><PricingCta plan="api" label="Upgrade to API" /></div>
          </div>
        ) : null}
        {!paid ? <p className="mt-4 text-xs text-muted">Free plan: {me.limits.freeScansPerDay} fresh scans a day, Predator AI verdicts, Ask the Hawk, Wallet Shield, shareable risk cards.</p> : null}
      </div>

      {me.plan === 'api' ? <ApiKeyCard me={me} /> : null}
      {paid ? <WatchtowerCard me={me} /> : null}
    </div>
  );
}

function ApiKeyCard({ me }: { me: Me }) {
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const key = me.apiKey;
  const pct = key ? Math.min(100, Math.round((key.used / key.limit) * 100)) : 0;

  async function issue() {
    setBusy(true);
    setNote(null);
    try {
      const { ok, data } = await post<{ key?: string }>('/api/account/api-key');
      if (ok && data.key) {
        setFresh(data.key);
        await refreshMe();
      } else setNote(data.error ?? 'Could not issue a key.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!fresh) return;
    await navigator.clipboard.writeText(fresh).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="card p-6 md:p-8">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">API access</div>
      <h2 className="mt-2 text-xl font-bold">Scan calls for your bots</h2>
      <p className="mt-2 text-sm text-muted">
        Send the key as <span className="font-mono text-bone">Authorization: Bearer rh_live_...</span> to <span className="font-mono text-bone">/api/scan/token</span>, <span className="font-mono text-bone">/api/scan/wallet</span> or <span className="font-mono text-bone">/api/scan</span>. Every response carries <span className="font-mono text-bone">X-RugHawk-Quota-Remaining</span>.
      </p>
      {key ? (
        <div className="mt-5 rounded-xl border border-graphite/60 bg-ink/40 p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Key <span className="font-mono text-bone">{key.prefix}…</span> · issued {day(key.createdAt)}{key.lastUsed ? ` · last used ${day(key.lastUsed)}` : ''}</span>
            <span className="text-muted">{key.used.toLocaleString('en-US')} / {key.limit.toLocaleString('en-US')} calls this month</span>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-graphite/60">
            <div className="h-full rounded-full bg-signal" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : (
        <p className="mt-5 text-sm text-muted">No key yet. Issue one below; it is shown once.</p>
      )}
      {fresh ? (
        <div className="mt-4 rounded-xl border border-signal/40 bg-signal/10 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-signal">Copy it now. It will not be shown again.</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all rounded-lg bg-ink px-3 py-2 font-mono text-xs">{fresh}</code>
            <button type="button" onClick={() => void copy()} className="btn-ghost !py-1.5 text-xs">{copied ? 'Copied' : 'Copy'}</button>
          </div>
        </div>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" onClick={() => void issue()} disabled={busy} className="btn-primary">{busy ? 'Working...' : key ? 'Rotate key' : 'Issue API key'}</button>
        <a href="mailto:security@raptorlabs.dev?subject=RugHawk%20API%20SLA" className="btn-ghost">SLA on request</a>
      </div>
      {note ? <p className="mt-3 text-xs text-signal">{note}</p> : null}
      <pre className="mt-5 overflow-x-auto rounded-xl border border-graphite/60 bg-ink/60 p-4 text-xs text-muted">{`curl -H "Authorization: Bearer rh_live_..." \\
  "https://rughawk.xyz/api/scan/token?mint=DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"`}</pre>
    </div>
  );
}

function WatchtowerCard({ me }: { me: Me }) {
  const [webhook, setWebhook] = useState(me.webhook?.url ?? '');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connectTelegram() {
    setBusy(true);
    try {
      const { ok, data } = await post<{ url?: string }>('/api/account/telegram');
      if (ok && data.url) window.open(data.url, '_blank', 'noopener');
      else setNote(data.error ?? 'Telegram is unavailable right now.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnectTelegram() {
    await post('/api/account/telegram', 'DELETE');
    await refreshMe();
  }

  async function saveWebhook() {
    setBusy(true);
    setNote(null);
    try {
      const { ok, data } = await post<{ secret?: string | null }>('/api/account/webhook', 'PUT', { url: webhook });
      if (!ok) setNote(data.error ?? 'Could not save the webhook.');
      else setNote(webhook ? 'Webhook saved.' : 'Webhook removed.');
      await refreshMe();
    } finally {
      setBusy(false);
    }
  }

  async function unwatch(address: string) {
    await fetch(`/api/watch?address=${address}`, { method: 'DELETE' });
    await refreshMe();
  }

  return (
    <div className="card p-6 md:p-8">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">Watchtower</div>
      <h2 className="mt-2 text-xl font-bold">Alerts when a watched token turns</h2>
      <p className="mt-2 text-sm text-muted">Press Watch on any token report. Every 10 minutes RugHawk re-scans it and alerts you when the grade worsens or liquidity collapses.</p>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-graphite/60 bg-ink/40 p-4 text-sm">
          <div className="font-semibold">Telegram</div>
          {me.telegram.enabled ? (
            me.telegram.connected ? (
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-safe">Connected</span>
                <button type="button" onClick={() => void disconnectTelegram()} className="btn-ghost !py-1.5 text-xs">Disconnect</button>
              </div>
            ) : (
              <div className="mt-2">
                <p className="text-muted">Opens @{me.telegram.bot}; press Start and alerts arrive in that chat.</p>
                <button type="button" onClick={() => void connectTelegram()} disabled={busy} className="btn-primary mt-3 !py-1.5 text-xs">Connect Telegram</button>
              </div>
            )
          ) : (
            <p className="mt-2 text-muted">Telegram delivery is being switched on. Until then every alert is listed here.</p>
          )}
        </div>
        <div className="rounded-xl border border-graphite/60 bg-ink/40 p-4 text-sm">
          <div className="font-semibold">Webhook {me.plan !== 'api' ? <span className="font-normal text-muted">(API plan)</span> : null}</div>
          {me.plan === 'api' ? (
            <div className="mt-2">
              <input value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://your-bot.example.com/rughawk" className="w-full rounded-lg border border-graphite bg-ink px-3 py-2 font-mono text-xs" />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void saveWebhook()} disabled={busy} className="btn-ghost !py-1.5 text-xs">Save</button>
                {me.webhook?.secret ? <span className="text-xs text-muted">Signing secret <span className="font-mono text-bone">{me.webhook.secret}</span></span> : null}
              </div>
              <p className="mt-2 text-xs text-muted">POST JSON with X-RugHawk-Signature: t=unix,v1=HMAC-SHA256(secret, t + &quot;.&quot; + body).</p>
            </div>
          ) : (
            <p className="mt-2 text-muted">Signed JSON alerts to your own endpoint come with the API plan.</p>
          )}
        </div>
      </div>
      {note ? <p className="mt-3 text-xs text-signal">{note}</p> : null}

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">Watching</div>
          {me.watches.length ? (
            <ul className="mt-2 divide-y divide-graphite/50 text-sm">
              {me.watches.map((w) => (
                <li key={w.address} className="flex items-center justify-between gap-2 py-2">
                  <Link href={`/token/${w.address}`} className="truncate underline underline-offset-4">{w.symbol ? `$${w.symbol}` : w.label ?? short(w.address)}</Link>
                  <span className="flex items-center gap-3 text-xs text-muted">
                    {w.grade ? <span>{w.grade} {w.risk}</span> : null}
                    <button type="button" onClick={() => void unwatch(w.address)} className="underline underline-offset-4 hover:text-bone">Remove</button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">Nothing watched yet.</p>
          )}
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">Recent alerts</div>
          {me.alerts.length ? (
            <ul className="mt-2 space-y-2">
              {me.alerts.map((a) => (
                <li key={`${a.address}-${a.created_at}`} className="rounded-lg border border-graphite/60 bg-ink/40 p-2.5 text-xs">
                  <span className={a.severity === 'critical' ? 'text-[#FF5A5A]' : 'text-signal'}>{a.severity.toUpperCase()}</span> · <Link href={`/token/${a.address}`} className="underline underline-offset-4">{a.symbol ? `$${a.symbol}` : short(a.address)}</Link> · {a.message}
                  <div className="text-muted">{new Date(a.created_at).toISOString().slice(0, 16).replace('T', ' ')} UTC</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">No alerts yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
