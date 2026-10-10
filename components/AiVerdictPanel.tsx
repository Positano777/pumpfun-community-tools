'use client';

import { useEffect, useRef, useState } from 'react';
import type { PublicAiVerdict } from '@/lib/scan/types';
import { LANGUAGES, type LanguageCode } from '@/lib/ai/languages';
import { voiceFor } from '@/lib/ai/voice';
import { useSpeaker } from './useHawk';

type Lang = 'en' | LanguageCode;

export function AiVerdictPanel({ kind, address, score }: { kind: 'token' | 'wallet'; address: string; score: number }) {
  const [verdict, setVerdict] = useState<PublicAiVerdict | null>(null);
  const [shown, setShown] = useState<PublicAiVerdict | null>(null);
  const [lang, setLang] = useState<Lang>('en');
  const [translating, setTranslating] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const speaker = useSpeaker();
  const translations = useRef<Partial<Record<Lang, PublicAiVerdict>>>({});

  useEffect(() => {
    let alive = true;
    setState('loading');
    setLang('en');
    translations.current = {};
    fetch(`/api/ai/verdict?kind=${kind}&address=${address}`)
      .then((r) => r.json())
      .then((d: { verdict?: PublicAiVerdict | null }) => {
        if (!alive) return;
        if (d.verdict) {
          setVerdict(d.verdict);
          setShown(d.verdict);
          translations.current.en = d.verdict;
          setState('ready');
        } else setState('unavailable');
      })
      .catch(() => alive && setState('unavailable'));
    return () => {
      alive = false;
    };
  }, [kind, address, score]);

  async function switchLang(next: Lang) {
    speaker.stop();
    setLang(next);
    const known = translations.current[next];
    if (known) {
      setShown(known);
      return;
    }
    if (next === 'en' || !verdict) return;
    setTranslating(true);
    try {
      const res = await fetch('/api/ai/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, address, score, lang: next }),
      });
      const d = (await res.json()) as { verdict?: PublicAiVerdict };
      if (res.ok && d.verdict) {
        translations.current[next] = d.verdict;
        setShown(d.verdict);
      } else {
        setLang('en');
        setShown(verdict);
      }
    } catch {
      setLang('en');
      setShown(verdict);
    } finally {
      setTranslating(false);
    }
  }

  const voice = voiceFor(lang);
  const reading = speaker.speaking === 'verdict';

  return (
    <div className="card relative overflow-hidden p-5 md:p-6">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-signal/70 to-transparent" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">Hawk verdict · Predator AI</div>
        {shown ? (
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor={`verdict-lang-${kind}`}>Language</label>
            <select
              id={`verdict-lang-${kind}`}
              value={lang}
              disabled={translating}
              onChange={(e) => void switchLang(e.target.value as Lang)}
              className="rounded-lg border border-graphite bg-ink/60 px-2 py-1.5 text-xs text-bone focus:border-signal/60 focus:outline-none"
              title="Read the verdict in another language"
            >
              <option value="en">English</option>
              {(Object.keys(LANGUAGES) as LanguageCode[]).map((code) => (
                <option key={code} value={code}>{LANGUAGES[code].label}</option>
              ))}
            </select>
            {voice ? (
              <button
                type="button"
                onClick={() => (reading ? speaker.stop() : void speaker.speak(`${shown.headline}. ${shown.summary}`, { id: 'verdict', lang: voice }))}
                className={`btn-ghost !px-3 !py-1.5 text-xs ${reading ? '!border-signal !text-signal' : ''}`}
                title="Hear the verdict (Deepgram Aura-2 on Workers AI)"
              >
                {reading ? 'Stop' : 'Listen'}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {state === 'loading' ? (
        <div className="mt-3 space-y-2">
          <div className="h-5 w-3/4 animate-pulse rounded bg-graphite/60" />
          <div className="h-4 w-full animate-pulse rounded bg-graphite/40" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-graphite/40" />
        </div>
      ) : state === 'unavailable' || !shown ? (
        <p className="mt-3 text-sm text-muted">The AI explanation is unavailable right now. Every finding below is deterministic and complete without it.</p>
      ) : (
        <div className={`mt-3 transition-opacity ${translating ? 'opacity-50' : ''}`}>
          <h3 className="text-xl font-bold leading-snug">{shown.headline}</h3>
          <p className="mt-2 leading-relaxed text-bone/85">{shown.summary}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {shown.topRisks.length ? (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted">Top risks</div>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {shown.topRisks.map((r) => (
                    <li key={r} className="flex gap-2"><span className="text-signal">▸</span>{r}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {shown.watch.length ? (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted">Watch next</div>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {shown.watch.map((r) => (
                    <li key={r} className="flex gap-2"><span className="text-caution">▸</span>{r}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <div className="mt-4 text-[11px] text-muted">
            Explains the deterministic findings; it cannot change the score. Confidence {shown.confidence}
            {lang !== 'en' ? ' · translated by Predator AI from the English verdict' : ''}
          </div>
        </div>
      )}
    </div>
  );
}
