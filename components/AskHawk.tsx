'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { PublicCopilotAnswer } from '@/lib/ai/copilot';
import { GradeBadge } from './ui';
import type { Grade } from '@/lib/scan/types';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  meta?: Pick<PublicCopilotAnswer, 'scans' | 'sources' | 'generated' | 'knowledge' | 'guard'>;
}

const SUGGESTIONS = [
  'What is a permanent delegate and why is it dangerous?',
  'How do bundled launches work on pump.fun?',
  'Is it safe to approve a token delegate for an airdrop claim?',
];

export function AskHawk() {
  const params = useSearchParams();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState(params.get('q') ?? '');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true);
    setInput('');
    const history = msgs.map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: 'user', content: question }]);
    try {
      const res = await fetch('/api/ai/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, history }) });
      const d = (await res.json()) as PublicCopilotAnswer & { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'The hawk could not answer.');
      setMsgs((m) => [...m, { role: 'assistant', content: d.answer, meta: { scans: d.scans, sources: d.sources, generated: d.generated, knowledge: d.knowledge, guard: d.guard } }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: e instanceof Error ? e.message : 'Something went wrong.' }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex min-h-[60vh] flex-col p-4 md:p-6">
      <div className="flex-1 space-y-4 overflow-y-auto">
        {msgs.length === 0 ? (
          <div className="py-10 text-center">
            <div className="text-lg font-bold">Ask about any token, wallet or Solana scam pattern.</div>
            <p className="mt-1 text-sm text-muted">Include an address and the hawk scans it first.</p>
            <div className="mt-6 flex flex-col items-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)} className="btn-ghost w-full max-w-md text-left text-xs">{s}</button>
              ))}
            </div>
          </div>
        ) : null}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'ml-auto max-w-[85%] rounded-2xl bg-signal/15 px-4 py-3 text-sm' : 'max-w-[92%] rounded-2xl border border-graphite/60 bg-ink/50 px-4 py-3 text-sm'}>
            <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
            {m.meta?.scans.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {m.meta.scans.map((s) => (
                  <Link key={s.address} href={`/${s.kind}/${s.address}`} className="inline-flex items-center gap-2 rounded-lg border border-graphite px-2 py-1 text-xs hover:border-signal/60">
                    {s.label ?? `${s.address.slice(0, 5)}…`} <GradeBadge grade={s.grade as Grade} score={s.risk} />
                  </Link>
                ))}
              </div>
            ) : null}
            {m.meta ? (
              <div className="mt-2 text-[11px] text-muted">
                {m.meta.sources.length ? `Sources: ${m.meta.sources.map((s) => s.title).join(' · ')} · ` : ''}
                {m.meta.knowledge !== 'none' ? 'grounded in the Hawk Playbook · ' : ''}
                {m.meta.generated ? 'Hawk copilot' : 'deterministic fallback'}
                {m.meta.guard.injectionScore !== null ? ` · injection check ${m.meta.guard.injectionScore.toFixed(2)}` : ''}
              </div>
            ) : null}
          </div>
        ))}
        {busy ? <div className="scan-line max-w-[60%] rounded-2xl border border-graphite/60 bg-ink/50 px-4 py-3 text-sm text-muted">Scanning and thinking...</div> : null}
        <div ref={end} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
        className="mt-4 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={800}
          placeholder="Is 7xKX...pump a rug? Who deployed it?"
          className="min-w-0 flex-1 rounded-xl border border-graphite bg-ink/60 px-4 py-3 text-sm placeholder:text-muted focus:border-signal/60 focus:outline-none"
        />
        <button type="submit" disabled={busy} className="btn-primary">Ask</button>
      </form>
    </div>
  );
}
