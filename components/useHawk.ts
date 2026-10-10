'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { streamAsk, transcribe, type HawkMeta, type Turn } from '@/lib/hawk-client';
import type { VoiceLang } from '@/lib/ai/voice';

export interface HawkMsg {
  role: 'user' | 'assistant';
  content: string;
  meta?: HawkMeta;
  /** Still being written. */
  pending?: boolean;
  /** Asked by voice: the answer is read aloud when it is complete. */
  spoken?: boolean;
}

/** Conversation state for the copilot with streamed answers. `ask` resolves with the finished answer. */
export function useHawk() {
  const [msgs, setMsgs] = useState<HawkMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const msgsRef = useRef<HawkMsg[]>([]);
  msgsRef.current = msgs;

  const ask = useCallback(async (q: string, opts: { spoken?: boolean } = {}): Promise<string> => {
    const question = q.trim();
    if (!question || busyRef.current) return '';
    busyRef.current = true;
    setBusy(true);
    const history: Turn[] = msgsRef.current.filter((m) => !m.pending && m.content).map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: 'user', content: question, spoken: opts.spoken }, { role: 'assistant', content: '', pending: true, spoken: opts.spoken }]);
    const patch = (fn: (last: HawkMsg) => HawkMsg) =>
      setMsgs((m) => {
        const copy = m.slice();
        const i = copy.length - 1;
        if (i >= 0 && copy[i].role === 'assistant') copy[i] = fn(copy[i]);
        return copy;
      });
    let answer = '';
    try {
      await streamAsk(question, history, {
        meta: (meta) => patch((l) => ({ ...l, meta })),
        delta: (t) => {
          answer += t;
          patch((l) => ({ ...l, content: l.content + t }));
        },
      });
      patch((l) => ({ ...l, pending: false }));
    } catch (e) {
      patch((l) => ({ ...l, content: l.content || (e instanceof Error ? e.message : 'Something went wrong.'), pending: false }));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
    return answer;
  }, []);

  return { msgs, busy, ask };
}

export interface SpeakerControl {
  /** Id of the text being read, or null. */
  speaking: string | null;
  speak: (text: string, opts?: { id?: string; lang?: VoiceLang }) => Promise<void>;
  stop: () => void;
}

/** One audio element per page: speaking something new stops whatever was playing. */
export function useSpeaker(): SpeakerControl {
  const [speaking, setSpeaking] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setSpeaking(null);
  }, []);

  const speak = useCallback(
    async (text: string, opts: { id?: string; lang?: VoiceLang } = {}) => {
      stop();
      const id = opts.id ?? text.slice(0, 40);
      const body = text.trim();
      if (!body) return;
      setSpeaking(id);
      try {
        const res = await fetch('/api/ai/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: body.slice(0, 1800), lang: opts.lang ?? 'en' }),
        });
        if (!res.ok) throw new Error('voice');
        const url = URL.createObjectURL(await res.blob());
        urlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (urlRef.current === url) urlRef.current = null;
          setSpeaking((s) => (s === id ? null : s));
        };
        await audio.play();
      } catch {
        setSpeaking((s) => (s === id ? null : s));
      }
    },
    [stop],
  );

  useEffect(() => stop, [stop]);

  return { speaking, speak, stop };
}

export interface VoiceControl {
  state: 'idle' | 'recording' | 'transcribing';
  supported: boolean;
  toggle: () => void;
}

const MAX_RECORDING_MS = 20_000;
/** Quiet this long after speech ends the recording on its own. */
const SILENCE_MS = 1_400;
/** RMS of the normalised waveform above which the microphone is hearing speech. */
const SPEECH_RMS = 0.02;

/**
 * Press to talk: records until the speaker goes quiet (or 20 seconds),
 * transcribes, hands the text back. The stop button still works for noisy
 * rooms; the silence watch only ever shortens a recording.
 */
export function useVoice(onText: (text: string) => void): VoiceControl {
  const [state, setState] = useState<VoiceControl['state']>('idle');
  const [supported, setSupported] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);
  const watch = useRef<number | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => {
    setSupported(typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia));
  }, []);

  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }, []);

  const clearWatch = () => {
    if (timer.current) window.clearTimeout(timer.current);
    if (watch.current) window.clearTimeout(watch.current);
    timer.current = null;
    watch.current = null;
    void audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
  };

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
        clearWatch();
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
      // Silence watch: an analyser on the same stream, sampled ten times a second.
      try {
        const ctx = new AudioContext();
        audioCtx.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        let heard = false;
        let quietSince = 0;
        const tick = () => {
          if (rec.state !== 'recording') return;
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          const now = performance.now();
          if (rms > SPEECH_RMS) {
            heard = true;
            quietSince = 0;
          } else if (heard) {
            if (!quietSince) quietSince = now;
            else if (now - quietSince > SILENCE_MS) {
              stop();
              return;
            }
          }
          watch.current = window.setTimeout(tick, 100);
        };
        tick();
      } catch {
        // no analyser: the stop button and the 20 s cap still end the recording
      }
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
