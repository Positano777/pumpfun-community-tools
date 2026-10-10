import { getEnv } from '@/lib/env';
import { transcribe } from '@/lib/ai/voice';
import { json, originAllowed } from '@/lib/http';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 2_500_000;

/** POST /api/ai/transcribe (audio body, up to 2.5 MB): a spoken question as text (Nova-3, Whisper fallback). */
export async function POST(req: Request) {
  if (!originAllowed(req)) return json({ error: 'Forbidden' }, { status: 403 });
  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) return json({ error: 'Recording too long.' }, { status: 413 });
  const audio = await req.arrayBuffer();
  if (!audio.byteLength || audio.byteLength > MAX_BYTES) return json({ error: 'No audio received.' }, { status: 400 });
  const { env } = await getEnv();
  if (!env.AI) return json({ error: 'Voice input unavailable right now.' }, { status: 503 });
  const heard = await transcribe(env.AI, env.AI_GATEWAY_ID, audio, req.headers.get('content-type') ?? 'audio/webm');
  if (!heard) return json({ error: 'Nothing was heard. Try again closer to the microphone.' }, { status: 422 });
  return json({ text: heard.text.slice(0, 800), confidence: heard.confidence });
}
