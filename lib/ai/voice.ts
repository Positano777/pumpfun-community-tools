/**
 * Spoken verdicts with Deepgram Aura on Workers AI: "hear the hawk" turns a
 * report into a 15-second audio briefing (accessibility, Telegram voice notes,
 * the demo video). Text is capped so one request can never run up the bill.
 */
import type { AiBinding } from '../env';
import { MODELS, gatewayIds } from './workers-ai';

export const MAX_TTS_CHARS = 600;

export async function speak(ai: AiBinding | undefined, gatewayId: string | undefined, text: string): Promise<Response | null> {
  if (!ai) return null;
  const input = { text: text.replace(/\u2014/g, ', ').slice(0, MAX_TTS_CHARS), speaker: 'orion', encoding: 'mp3' };
  for (const id of [...gatewayIds(gatewayId), null]) {
    try {
      const res = (await ai.run(MODELS.tts, input, { returnRawResponse: true, ...(id ? { gateway: { id, metadata: { feature: 'tts' } } } : {}) })) as unknown;
      if (res instanceof Response && res.ok) return res;
      if (res instanceof ReadableStream) return new Response(res, { headers: { 'Content-Type': 'audio/mpeg' } });
    } catch {
      // next path
    }
  }
  return null;
}
