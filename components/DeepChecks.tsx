'use client';

import { useEffect, useState } from 'react';
import type { DnaMatch, Socials } from '@/lib/scan/types';
import type { SiteReview } from '@/lib/ai/site';
import type { LogoReview } from '@/lib/ai/vision';
import { Section } from './ui';

export function DeepChecks({ mint, website, socials, dna }: { mint: string; website: string | null; socials: Socials; dna: DnaMatch[] }) {
  const [site, setSite] = useState<SiteReview | null>(null);
  const [siteBusy, setSiteBusy] = useState(false);
  const [logo, setLogo] = useState<{ review: LogoReview | null; impersonation: boolean } | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [watching, setWatching] = useState(false);
  const [alerts, setAlerts] = useState<{ severity: string; message: string; created_at: number }[]>([]);

  useEffect(() => {
    fetch(`/api/watch?address=${mint}`).then((r) => r.json()).then((d) => setAlerts(d.alerts ?? [])).catch(() => undefined);
  }, [mint]);

  async function runSite() {
    if (!website) return;
    setSiteBusy(true);
    try {
      const r = await fetch('/api/ai/site', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: website }) });
      const d = await r.json();
      setSite(d.review ?? null);
    } finally {
      setSiteBusy(false);
    }
  }

  async function runLogo() {
    setLogoBusy(true);
    try {
      const r = await fetch(`/api/ai/logo?mint=${mint}`);
      setLogo(await r.json());
    } finally {
      setLogoBusy(false);
    }
  }

  async function watch() {
    const r = await fetch('/api/watch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: mint }) });
    setWatching(r.ok);
  }

  const verdictTone = site?.verdict === 'drainer-likely' ? 'text-[#FF5A5A]' : site?.verdict === 'suspicious' ? 'text-caution' : 'text-safe';

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Section title="Website forensics" kicker="Browser Run + Workers AI">
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-2"><span className="text-muted">Website</span>{website ? <a href={website} target="_blank" rel="noreferrer noopener nofollow" className="truncate text-bone underline underline-offset-4">{socials.domain ?? website}</a> : <span className="text-muted">none</span>}</div>
          <div className="flex justify-between gap-2"><span className="text-muted">Domain age</span><span className={socials.domainAgeDays !== null && socials.domainAgeDays < 30 ? 'text-caution' : ''}>{socials.domainAgeDays !== null ? `${socials.domainAgeDays} days` : 'unknown'}</span></div>
          <div className="flex justify-between gap-2"><span className="text-muted">X</span>{socials.twitter ? <a href={socials.twitter} target="_blank" rel="noreferrer noopener nofollow" className="truncate text-bone underline underline-offset-4">link</a> : <span className="text-muted">none</span>}</div>
          <div className="flex justify-between gap-2"><span className="text-muted">Telegram</span>{socials.telegram ? <a href={socials.telegram} target="_blank" rel="noreferrer noopener nofollow" className="truncate text-bone underline underline-offset-4">link</a> : <span className="text-muted">none</span>}</div>
        </div>
        {website ? (
          <button type="button" onClick={runSite} disabled={siteBusy} className="btn-ghost mt-4 w-full text-xs">
            {siteBusy ? 'Rendering in a headless browser...' : 'Render & review the site'}
          </button>
        ) : null}
        {site ? (
          <div className="mt-4 space-y-2 text-sm">
            <div className={`font-bold uppercase tracking-wider ${verdictTone}`}>{site.verdict.replace('-', ' ')}</div>
            <p className="text-muted">{site.summary}</p>
            {site.lures.length ? <ul className="list-inside list-disc text-xs text-caution">{site.lures.map((l) => <li key={l}>{l}</li>)}</ul> : null}
            {site.screenshotKey ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/screens/${site.screenshotKey.split('/').pop()}`} alt="Rendered website" className="mt-2 rounded-lg border border-graphite" />
            ) : null}
          </div>
        ) : null}
      </Section>

      <Section title="Identity forensics" kicker="Vision + Scam DNA">
        <button type="button" onClick={runLogo} disabled={logoBusy} className="btn-ghost w-full text-xs">
          {logoBusy ? 'Llama 4 Scout is looking...' : 'Check the logo for brand impersonation'}
        </button>
        {logo ? (
          <div className="mt-3 text-sm">
            {logo.review ? (
              <>
                <div className={logo.impersonation ? 'font-bold text-signal' : 'font-bold text-safe'}>
                  {logo.impersonation ? `Imitates ${logo.review.brand}` : logo.review.brand ? `Resembles ${logo.review.brand} (low concern)` : 'No brand imitation detected'}
                </div>
                <p className="mt-1 text-muted">{logo.review.description}</p>
              </>
            ) : (
              <p className="text-muted">No logo could be analysed.</p>
            )}
          </div>
        ) : null}
        <div className="mt-5 text-xs font-semibold uppercase tracking-wider text-muted">Scam DNA matches</div>
        {dna.length ? (
          <ul className="mt-2 space-y-1.5 text-sm">
            {dna.map((m) => (
              <li key={m.address} className="flex justify-between gap-2">
                <a href={`/token/${m.address}`} className="underline underline-offset-4">{m.symbol || m.name || m.address.slice(0, 6)}</a>
                <span className="font-mono text-xs text-signal">{Math.round(m.similarity * 100)}% · risk {m.risk}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">No near-identical flagged tokens in the index.</p>
        )}
      </Section>

      <Section title="Watchtower" kicker="Alerts every 10 minutes">
        <p className="text-sm text-muted">RugHawk re-scans watched tokens and records an alert when the grade worsens or liquidity collapses.</p>
        <button type="button" onClick={watch} disabled={watching} className="btn-primary mt-4 w-full text-xs">
          {watching ? 'Watching this token' : 'Watch this token'}
        </button>
        <div className="mt-4 space-y-2">
          {alerts.length ? (
            alerts.map((a) => (
              <div key={a.created_at + a.message} className="rounded-lg border border-graphite/60 bg-ink/40 p-2.5 text-xs">
                <span className={a.severity === 'critical' ? 'text-[#FF5A5A]' : 'text-signal'}>{a.severity.toUpperCase()}</span> · {a.message}
                <div className="text-muted">{new Date(a.created_at).toISOString().slice(0, 16).replace('T', ' ')} UTC</div>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted">No alerts yet.</p>
          )}
        </div>
      </Section>
    </div>
  );
}
