'use client';

import { useCallback, useState } from 'react';
import { HawkMessage, MicButton } from './HawkChat';
import { useHawk, useSpeaker, useVoice } from './useHawk';

/** The copilot on the report itself: every question carries this address, so the answer is grounded in this scan. */
export function AskInline({ kind, address, label }: { kind: 'token' | 'wallet'; address: string; label: string | null }) {
  const { msgs, busy, ask } = useHawk();
  const speaker = useSpeaker();
  const [input, setInput] = useState('');
  const subject = label ? `${label} (${address})` : address;
  const suggestions =
    kind === 'token'
      ? [`Who deployed ${subject} and should that worry me?`, `Did the deployer of ${subject} sell, lock or burn its bag?`, `What is the single biggest risk in ${subject} right now?`]
      : [`Is it safe to interact with ${subject}?`, `Where did the money in ${subject} come from?`, `Does ${subject} look like a bot, a treasury or a person?`];

  const send = useCallback(
    async (q: string, spoken = false) => {
      const question = q.trim();
      if (!question) return;
      setInput('');
      const answer = await ask(question.includes(address) ? question : `${question} (${address})`, { spoken });
      if (spoken && answer) void speaker.speak(answer, { id: 'latest' });
    },
    [address, ask, speaker.speak],
  );
  const voice = useVoice((text) => void send(text, true));

  return (
    <div className="card p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">Ask Predator AI about this {kind}</div>
          <p className="mt-1 text-sm text-muted">Answers come from this scan and the Hawk Playbook, in the language you ask in. The score never changes.</p>
        </div>
      </div>
      {msgs.length === 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => void send(s)} className="btn-ghost !py-1.5 text-xs">{s.replace(` (${address})`, '')}</button>
          ))}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {msgs.map((m, i) => (
            <HawkMessage
              key={i}
              m={{ ...m, content: m.role === 'user' ? m.content.replace(` (${address})`, '') : m.content }}
              id={i === msgs.length - 1 && m.spoken ? 'latest' : `inline-${i}`}
              speaker={speaker}
            />
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="mt-4 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={700}
          placeholder={voice.state === 'recording' ? 'Listening... pause when you are done' : voice.state === 'transcribing' ? 'Hearing you...' : `Ask anything about this ${kind}`}
          className="min-w-0 flex-1 rounded-xl border border-graphite bg-ink/60 px-4 py-2.5 text-sm placeholder:text-muted focus:border-signal/60 focus:outline-none"
        />
        <MicButton voice={voice} className="!py-2" />
        <button type="submit" disabled={busy} className="btn-primary !py-2">Ask</button>
      </form>
    </div>
  );
}
