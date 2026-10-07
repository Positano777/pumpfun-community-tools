import { getEnv } from '@/lib/env';
import { MAX_TTS_CHARS, speak } from '@/lib/ai/voice';
import { json, originAllowed } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** POST /api/ai/speak { text }: the verdict as audio (Deepgram Aura on Workers AI). */
export async function POST(req: Request) {
  if (!originAllowed(req)) return json({ error: 'Forbidden' }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { text?: unknown };
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > MAX_TTS_CHARS) return json({ error: `Text required (max ${MAX_TTS_CHARS} characters).` }, { status: 400 });
  const { env } = await getEnv();
  const audio = await speak(env.AI, env.AI_GATEWAY_ID, text);
  if (!audio) return json({ error: 'Voice unavailable right now.' }, { status: 503 });
  return new Response(audio.body, { headers: { 'Content-Type': audio.headers.get('content-type') ?? 'audio/mpeg', 'Cache-Control': 'no-store' } });
}
