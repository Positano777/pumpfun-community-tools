'use client';

import { useEffect, useRef, useState } from 'react';
import type { PublicAiVerdict } from '@/lib/scan/types';

export function AiVerdictPanel({ kind, address, score }: { kind: 'token' | 'wallet'; address: string; score: number }) {
  const [verdict, setVerdict] = useState<PublicAiVerdict | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let alive = true;
    setState('loading');
    fetch(`/api/ai/verdict?kind=${kind}&address=${address}`)
      .then((r) => r.json())
      .then((d: { verdict?: PublicAiVerdict | null }) => {
        if (!alive) return;
        if (d.verdict) {
          setVerdict(d.verdict);
          setState('ready');
        } else setState('unavailable');
      })
      .catch(() => alive && setState('unavailable'));
    return () => {
      alive = false;
    };
  }, [kind, address, score]);

  async function listen() {
    if (!verdict) return;
    setSpeaking(true);
    try {
      const res = await fetch('/api/ai/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `${verdict.headline} ${verdict.summary}`.slice(0, 600) }),
      });
      if (!res.ok) throw new Error('voice');
      const url = URL.createObjectURL(await res.blob());
      audioRef.current?.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setSpeaking(false);
      await audio.play();
    } catch {
      setSpeaking(false);
    }
  }

  return (
    <div className="card relative overflow-hidden p-5 md:p-6">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-signal/70 to-transparent" />
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">Hawk verdict · AI brief</div>
        {verdict ? (
          <button type="button" onClick={listen} disabled={speaking} className="btn-ghost !px-3 !py-1.5 text-xs">
            {speaking ? 'Speaking...' : 'Listen'}
          </button>
        ) : null}
      </div>
      {state === 'loading' ? (
        <div className="mt-3 space-y-2">
          <div className="h-5 w-3/4 animate-pulse rounded bg-graphite/60" />
          <div className="h-4 w-full animate-pulse rounded bg-graphite/40" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-graphite/40" />
        </div>
      ) : state === 'unavailable' || !verdict ? (
        <p className="mt-3 text-sm text-muted">The AI explanation is unavailable right now. Every finding below is deterministic and complete without it.</p>
      ) : (
        <div className="mt-3">
          <h3 className="text-xl font-bold leading-snug">{verdict.headline}</h3>
          <p className="mt-2 leading-relaxed text-bone/85">{verdict.summary}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {verdict.topRisks.length ? (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted">Top risks</div>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {verdict.topRisks.map((r) => (
                    <li key={r} className="flex gap-2"><span className="text-signal">▸</span>{r}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {verdict.watch.length ? (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted">Watch next</div>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {verdict.watch.map((r) => (
                    <li key={r} className="flex gap-2"><span className="text-caution">▸</span>{r}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <div className="mt-4 text-[11px] text-muted">
            Explains the deterministic findings; it cannot change the score. Confidence {verdict.confidence}
          </div>
        </div>
      )}
    </div>
  );
}
