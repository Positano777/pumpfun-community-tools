/**
 * Voice on Workers AI.
 *
 * Spoken output: Deepgram Aura-2 ("hear the hawk" turns a verdict, a copilot
 * answer or the market pulse into a short audio briefing), with Aura-1 as
 * the fallback and the Spanish Aura-2 model for Spanish verdicts. Text is
 * capped so one request can never run up the bill.
 *
 * Spoken input: Deepgram Nova-3 with key-term prompting for the crypto
 * vocabulary a trader actually says ("pump.fun", "Token-2022", "Raydium"),
 * and language detection so a question asked in Spanish or Turkish is
 * transcribed as such. Whisper large v3 turbo is the fallback.
 */
import type { AiBinding } from '../env';
import { MODELS, gatewayIds, runModel } from './workers-ai';
import { toBase64 } from './bytes';

export const MAX_TTS_CHARS = 600;

export type VoiceLang = 'en' | 'es';

/** Each model has its own speaker list, so the voice travels with the model. */
const VOICES: Record<VoiceLang, { model: string; speaker: string }[]> = {
  en: [
    { model: MODELS.tts, speaker: 'orion' },
    { model: MODELS.ttsFallback, speaker: 'orion' },
  ],
  es: [
    { model: MODELS.ttsSpanish, speaker: 'javier' },
    { model: MODELS.tts, speaker: 'orion' },
    { model: MODELS.ttsFallback, speaker: 'orion' },
  ],
};

export function isVoiceLang(v: unknown): v is VoiceLang {
  return v === 'en' || v === 'es';
}

/** Which spoken voice reads a verdict language; null when none does. */
export function voiceFor(lang: string): VoiceLang | null {
  return lang === 'en' ? 'en' : lang === 'es' ? 'es' : null;
}

/**
 * Prose the way a voice should read it: markdown bullets, emphasis and
 * headings dropped, addresses shortened, whitespace collapsed, cut at a
 * sentence end inside the cap.
 */
export function speakable(text: string, max = MAX_TTS_CHARS): string {
  let t = text
    .replace(/\u2014/g, ', ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*(?:[-*•▸]|\d+[.)])\s+/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/g, (a) => `${a.slice(0, 4)} ${a.slice(-4)}`)
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  t = end > max * 0.5 ? head.slice(0, end + 1) : head.slice(0, head.lastIndexOf(' ')).trim();
  return t;
}

export async function speak(ai: AiBinding | undefined, gatewayId: string | undefined, text: string, lang: VoiceLang = 'en'): Promise<Response | null> {
  if (!ai) return null;
  const spoken = speakable(text);
  if (!spoken) return null;
  for (const voice of VOICES[lang]) {
    const input = { text: spoken, speaker: voice.speaker, encoding: 'mp3' };
    for (const id of [...gatewayIds(gatewayId), null]) {
      try {
        const res = (await ai.run(voice.model, input, { returnRawResponse: true, ...(id ? { gateway: { id, metadata: { feature: 'tts' } } } : {}) })) as unknown;
        if (res instanceof Response && res.ok) return res;
        if (res instanceof ReadableStream) return new Response(res, { headers: { 'Content-Type': 'audio/mpeg' } });
      } catch {
        // next path, then next model
      }
    }
  }
  return null;
}

/**
 * Key terms Nova-3 should expect. A trader asks about launchpads, programs
 * and wallet brands that a general vocabulary mangles ("pump fund",
 * "radium"); prompting them keeps the address-free part of a question exact.
 */
export const KEYTERMS = 'RugHawk Solana pump.fun PumpSwap Raydium Meteora Jupiter Phantom Solflare Backpack Token-2022 Streamflow Jito bonding curve mint authority freeze authority permanent delegate transfer hook rug pull deployer bundled wallets sniper airdrop drainer memecoin honeypot liquidity';

/** The transcript out of a Nova-3 (Deepgram JSON) or Whisper ({text}) response. */
export function transcriptOf(result: unknown): { text: string; confidence: number | null } | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as {
    text?: unknown;
    results?: { channels?: { alternatives?: { transcript?: unknown; confidence?: unknown }[] }[] };
    result?: unknown;
  };
  if (typeof r.text === 'string' && r.text.trim()) return { text: r.text.trim(), confidence: null };
  const alt = r.results?.channels?.[0]?.alternatives?.[0];
  if (alt && typeof alt.transcript === 'string' && alt.transcript.trim()) {
    return { text: alt.transcript.trim(), confidence: typeof alt.confidence === 'number' ? alt.confidence : null };
  }
  // Some paths wrap the payload once more.
  if (r.result && typeof r.result === 'object') return transcriptOf(r.result);
  return null;
}

export interface Transcription {
  text: string;
  confidence: number | null;
  model: string;
}

/** Spoken audio as text: Nova-3 first, Whisper when Nova-3 fails or hears nothing. */
export async function transcribe(ai: AiBinding, gatewayId: string | undefined, audio: ArrayBuffer, contentType: string): Promise<Transcription | null> {
  try {
    const { result } = await runModel(
      ai,
      MODELS.transcribe,
      {
        audio: { body: new Response(audio).body, contentType: contentType.split(';')[0] || 'audio/webm' },
        keyterm: KEYTERMS,
        detect_language: true,
        smart_format: true,
        punctuate: true,
      },
      gatewayId,
      { label: 'transcribe' },
    );
    const t = transcriptOf(result);
    if (t) return { ...t, model: MODELS.transcribe };
  } catch (e) {
    console.warn('[ai] nova-3 failed:', e instanceof Error ? e.message : e);
  }
  try {
    const { result } = await runModel(ai, MODELS.transcribeFallback, { audio: toBase64(audio), task: 'transcribe' }, gatewayId, { label: 'transcribe-fallback' });
    const t = transcriptOf(result);
    if (t) return { ...t, model: MODELS.transcribeFallback };
  } catch (e) {
    console.warn('[ai] whisper failed:', e instanceof Error ? e.message : e);
  }
  return null;
}
