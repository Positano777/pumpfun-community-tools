'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { streamAsk, transcribe, type HawkMeta, type Turn } from '@/lib/hawk-client';

export interface HawkMsg {
  role: 'user' | 'assistant';
  content: string;
  meta?: HawkMeta;
  /** Still being written. */
  pending?: boolean;
}

/** Conversation state for the copilot with streamed answers. */
export function useHawk() {
  const [msgs, setMsgs] = useState<HawkMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const msgsRef = useRef<HawkMsg[]>([]);
  msgsRef.current = msgs;

  const ask = useCallback(async (q: string) => {
    const question = q.trim();
    if (!question || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const history: Turn[] = msgsRef.current.filter((m) => !m.pending && m.content).map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: 'user', content: question }, { role: 'assistant', content: '', pending: true }]);
    const patch = (fn: (last: HawkMsg) => HawkMsg) =>
      setMsgs((m) => {
        const copy = m.slice();
        const i = copy.length - 1;
        if (i >= 0 && copy[i].role === 'assistant') copy[i] = fn(copy[i]);
        return copy;
      });
    try {
      await streamAsk(question, history, {
        meta: (meta) => patch((l) => ({ ...l, meta })),
        delta: (t) => patch((l) => ({ ...l, content: l.content + t })),
      });
      patch((l) => ({ ...l, pending: false }));
    } catch (e) {
      patch((l) => ({ ...l, content: l.content || (e instanceof Error ? e.message : 'Something went wrong.'), pending: false }));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  return { msgs, busy, ask };
}

export interface VoiceControl {
  state: 'idle' | 'recording' | 'transcribing';
  supported: boolean;
  toggle: () => void;
}

const MAX_RECORDING_MS = 20_000;

/** Press to talk: records up to 20 seconds, transcribes, hands the text back. */
export function useVoice(onText: (text: string) => void): VoiceControl {
  const [state, setState] = useState<VoiceControl['state']>('idle');
  const [supported, setSupported] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => {
    setSupported(typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia));
  }, []);

  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timer.current) {
          window.clearTimeout(timer.current);
          timer.current = null;
        }
        setState('transcribing');
        try {
          const text = await transcribe(new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' }));
          if (text) onTextRef.current(text);
        } catch {
          // the user can type instead
        } finally {
          setState('idle');
        }
      };
      recorder.current = rec;
      rec.start();
      setState('recording');
      timer.current = window.setTimeout(stop, MAX_RECORDING_MS);
    } catch {
      setSupported(false);
      setState('idle');
    }
  }, [stop]);

  const toggle = useCallback(() => {
    if (state === 'recording') stop();
    else if (state === 'idle') void start();
  }, [state, start, stop]);

  return { state, supported, toggle };
}
