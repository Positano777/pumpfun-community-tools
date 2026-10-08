import { getEnv } from '@/lib/env';
import { askHawk, askHawkStream, publicAnswer } from '@/lib/ai/copilot';
import { sseResponse } from '@/lib/ai/sse';
import { fail, json, originAllowed } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ai/ask { question, history?, stream? }: the forensic copilot.
 * With stream: true the answer arrives as server-sent events: one `meta`
 * event (scans, sources, guard, knowledge, generated), then `delta` events
 * carrying text, then `done`.
 */
export async function POST(req: Request) {
  if (!originAllowed(req)) return json({ error: 'Forbidden' }, { status: 403 });
  try {
    const body = (await req.json().catch(() => ({}))) as { question?: unknown; history?: unknown; stream?: unknown };
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question || question.length > 800) return json({ error: 'Ask a question (max 800 characters).' }, { status: 400 });
    const history = Array.isArray(body.history)
      ? (body.history as { role?: string; content?: string }[])
          .filter((h) => (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
          .map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content as string }))
      : [];
    const { env, ctx } = await getEnv();
    if (body.stream !== true) return json(publicAnswer(await askHawk(env, ctx, question, history)));
    const { meta, stream, fallback } = await askHawkStream(env, ctx, question, history);
    return sseResponse(meta, stream, (t) => t.replace(/\u2014/g, ', '), fallback);
  } catch (e) {
    return fail(e);
  }
}
