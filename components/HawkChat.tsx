'use client';

import Link from 'next/link';
import { GradeBadge } from './ui';
import type { Grade } from '@/lib/scan/types';
import type { HawkMsg, SpeakerControl, VoiceControl } from './useHawk';

export function HawkMessage({ m, id, speaker }: { m: HawkMsg; id?: string; speaker?: SpeakerControl }) {
  const readable = m.role === 'assistant' && !m.pending && m.content.length > 0 && speaker && id;
  const reading = readable && speaker.speaking === id;
  return (
    <div className={m.role === 'user' ? 'ml-auto max-w-[85%] rounded-2xl bg-signal/15 px-4 py-3 text-sm' : 'max-w-[92%] rounded-2xl border border-graphite/60 bg-ink/50 px-4 py-3 text-sm'}>
      <div className="whitespace-pre-wrap leading-relaxed">
        {m.content}
        {m.pending ? <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulsefade rounded-sm bg-signal align-middle" aria-hidden /> : null}
        {m.pending && !m.content ? <span className="text-muted">Predator AI is reading the evidence...</span> : null}
      </div>
      {m.meta?.scans.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {m.meta.scans.map((s) => (
            <Link key={s.address} href={`/${s.kind}/${s.address}`} className="inline-flex items-center gap-2 rounded-lg border border-graphite px-2 py-1 text-xs hover:border-signal/60">
              {s.label ?? `${s.address.slice(0, 5)}…`} <GradeBadge grade={s.grade as Grade} score={s.risk} />
            </Link>
          ))}
        </div>
      ) : null}
      {m.meta && !m.pending ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
          <span>
            {m.meta.sources.length ? `Sources: ${m.meta.sources.map((s) => s.title).join(' · ')} · ` : ''}
            {m.meta.knowledge !== 'none' ? 'grounded in the Hawk Playbook · ' : ''}
            {m.meta.generated ? 'Predator AI' : 'deterministic fallback'}
            {m.meta.guard.injectionScore !== null ? ` · injection check ${m.meta.guard.injectionScore.toFixed(2)}` : ''}
          </span>
          {readable ? (
            <button
              type="button"
              onClick={() => (reading ? speaker.stop() : void speaker.speak(m.content, { id }))}
              className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${reading ? 'border-signal text-signal' : 'border-graphite text-bone hover:border-signal/60'}`}
              aria-label={reading ? 'Stop reading' : 'Read this answer aloud'}
            >
              {reading ? 'Stop' : 'Listen'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function MicButton({ voice, className = '' }: { voice: VoiceControl; className?: string }) {
  if (!voice.supported) return null;
  const label = voice.state === 'recording' ? 'Stop' : voice.state === 'transcribing' ? 'Hearing...' : 'Speak';
  return (
    <button
      type="button"
      onClick={voice.toggle}
      disabled={voice.state === 'transcribing'}
      aria-label={voice.state === 'recording' ? 'Stop recording' : 'Ask by voice'}
      title="Ask by voice: the hawk stops listening when you go quiet and reads the answer back"
      className={`btn-ghost ${voice.state === 'recording' ? '!border-signal !text-signal animate-pulsefade' : ''} ${className}`}
    >
      {label}
    </button>
  );
}
