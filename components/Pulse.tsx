'use client';

import { useEffect, useState } from 'react';
import type { Pulse as PulseData, PatternKey } from '@/lib/ai/pulse-stats';
import { PATTERN_LABELS } from '@/lib/ai/pulse-stats';

/** The last 24 hours of flagged launches, counted by the engine and phrased by Predator AI. */
export function Pulse() {
  const [pulse, setPulse] = useState<PulseData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch('/api/ai/pulse')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('pulse'))))
      .then((d: PulseData) => setPulse(d))
      .catch(() => setFailed(true));
  }, []);

  if (failed) return null;
  if (!pulse) {
    return (
      <div className="card mx-auto mt-8 max-w-3xl p-5 text-left">
        <div className="h-3 w-40 animate-pulse rounded bg-graphite/60" />
        <div className="mt-3 h-5 w-3/4 animate-pulse rounded bg-graphite/60" />
        <div className="mt-2 h-4 w-full animate-pulse rounded bg-graphite/40" />
      </div>
    );
  }
  const chips = (Object.entries(pulse.stats.patterns) as [PatternKey, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  return (
    <div className="card mx-auto mt-8 max-w-3xl p-5 text-left">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">Market pulse · Predator AI</div>
        <div className="text-[11px] text-muted">last {pulse.stats.windowHours} hours · {pulse.stats.flagged} flagged</div>
      </div>
      <h3 className="mt-2 text-lg font-bold leading-snug">{pulse.headline}</h3>
      <p className="mt-1 text-sm text-bone/80">{pulse.body}</p>
      {pulse.watch ? <p className="mt-1 text-sm text-muted">{pulse.watch}</p> : null}
      {chips.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map(([k, n]) => (
            <span key={k} className="chip border-graphite text-bone">
              <span className="font-mono text-signal">{n}</span> {PATTERN_LABELS[k]}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
