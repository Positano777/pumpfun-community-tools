'use client';

import { useEffect, useState } from 'react';
import type { ShieldBrief } from '@/lib/ai/shield-brief';
import { useSpeaker } from './useHawk';

/** The Shield report in plain English, refreshed whenever the wallet state changes. */
export function ShieldBriefCard({ owner, stateKey }: { owner: string; stateKey: string }) {
  const [brief, setBrief] = useState<ShieldBrief | null>(null);
  const [generated, setGenerated] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const speaker = useSpeaker();

  useEffect(() => {
    let alive = true;
    setState('loading');
    fetch('/api/ai/shield', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner }) })
      .then((r) => r.json())
      .then((d: { brief?: ShieldBrief; generated?: boolean }) => {
        if (!alive) return;
        if (d.brief) {
          setBrief(d.brief);
          setGenerated(Boolean(d.generated));
          setState('ready');
        } else setState('unavailable');
      })
      .catch(() => alive && setState('unavailable'));
    return () => {
      alive = false;
    };
  }, [owner, stateKey]);

  if (state === 'unavailable') return null;
  const reading = speaker.speaking === 'shield';
  return (
    <div className="card relative overflow-hidden p-5 md:p-6">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-signal/70 to-transparent" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">Hawk briefing · Predator AI</div>
        {brief ? (
          <button
            type="button"
            onClick={() => (reading ? speaker.stop() : void speaker.speak(`${brief.headline}. ${brief.summary} ${brief.actions.join(' ')}`, { id: 'shield' }))}
            className={`btn-ghost !px-3 !py-1.5 text-xs ${reading ? '!border-signal !text-signal' : ''}`}
          >
            {reading ? 'Stop' : 'Listen'}
          </button>
        ) : null}
      </div>
      {state === 'loading' || !brief ? (
        <div className="mt-3 space-y-2">
          <div className="h-5 w-2/3 animate-pulse rounded bg-graphite/60" />
          <div className="h-4 w-full animate-pulse rounded bg-graphite/40" />
        </div>
      ) : (
        <div className="mt-3">
          <h3 className="text-xl font-bold leading-snug">{brief.headline}</h3>
          <p className="mt-2 leading-relaxed text-bone/85">{brief.summary}</p>
          {brief.actions.length ? (
            <ul className="mt-3 space-y-1 text-sm">
              {brief.actions.map((a) => (
                <li key={a} className="flex gap-2"><span className="text-signal">▸</span>{a}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 text-[11px] text-muted">{generated ? 'Phrases the deterministic Shield report; nothing moves unless you sign it.' : 'Engine wording (no model available).'}</div>
        </div>
      )}
    </div>
  );
}
