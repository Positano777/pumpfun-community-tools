'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { HawkMessage, MicButton } from './HawkChat';
import { useHawk, useSpeaker, useVoice } from './useHawk';

const SUGGESTIONS = [
  'What is a permanent delegate and why is it dangerous?',
  'How do bundled launches work on pump.fun?',
  'Is it safe to approve a token delegate for an airdrop claim?',
];

export function AskHawk() {
  const params = useSearchParams();
  const { msgs, busy, ask } = useHawk();
  const speaker = useSpeaker();
  const [input, setInput] = useState(params.get('q') ?? '');
  const end = useRef<HTMLDivElement | null>(null);
  const autoAsked = useRef(false);

  // A spoken question gets a spoken answer: the hands-free loop.
  const onVoice = useCallback(
    async (text: string) => {
      setInput('');
      const answer = await ask(text, { spoken: true });
      if (answer) void speaker.speak(answer, { id: 'latest' });
    },
    [ask, speaker.speak],
  );
  const voice = useVoice((text) => void onVoice(text));

  // Follow the conversation; an empty page stays at the top.
  useEffect(() => {
    if (msgs.length) end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [msgs]);

  // Arriving from the search box with a question: ask it straight away.
  useEffect(() => {
    const q = params.get('q');
    if (q && !autoAsked.current) {
      autoAsked.current = true;
      setInput('');
      void ask(q);
    }
  }, [params, ask]);

  function submit(q: string) {
    const question = q.trim();
    if (!question) return;
    setInput('');
    void ask(question);
  }

  return (
    <div className="card flex min-h-[60vh] flex-col p-4 md:p-6">
      <div className="flex-1 space-y-4 overflow-y-auto">
        {msgs.length === 0 ? (
          <div className="py-10 text-center">
            <div className="text-lg font-bold">Ask about any token, wallet or Solana scam pattern.</div>
            <p className="mt-1 text-sm text-muted">Include an address and the hawk scans it first. Type in any language, or press Speak: the hawk listens until you go quiet and reads the answer back.</p>
            <div className="mt-6 flex flex-col items-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => submit(s)} className="btn-ghost w-full max-w-md text-left text-xs">{s}</button>
              ))}
            </div>
          </div>
        ) : null}
        {msgs.map((m, i) => (
          <HawkMessage key={i} m={m} id={i === msgs.length - 1 && m.spoken ? 'latest' : `msg-${i}`} speaker={speaker} />
        ))}
        <div ref={end} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="mt-4 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={800}
          placeholder={voice.state === 'recording' ? 'Listening... pause when you are done' : voice.state === 'transcribing' ? 'Hearing you...' : 'Is 7xKX...pump a rug? Who deployed it?'}
          className="min-w-0 flex-1 rounded-xl border border-graphite bg-ink/60 px-4 py-3 text-sm placeholder:text-muted focus:border-signal/60 focus:outline-none"
        />
        <MicButton voice={voice} />
        <button type="submit" disabled={busy} className="btn-primary">Ask</button>
      </form>
    </div>
  );
}
