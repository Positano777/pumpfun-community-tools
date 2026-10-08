/**
 * Browser-side client for the copilot: streams an answer as server-sent
 * events and turns a voice recording into text. Shared by the Ask the Hawk
 * page and the inline panel on every report.
 */
export interface HawkScan {
  kind: 'token' | 'wallet';
  address: string;
  label: string | null;
  risk: number;
  grade: string;
}

export interface HawkMeta {
  scans: HawkScan[];
  sources: { title: string; url?: string }[];
  guard: { allowed: boolean; injectionScore: number | null; unsafeCategories: string[]; reason?: string };
  knowledge: 'semantic' | 'keyword' | 'none';
  generated: boolean;
}

export type Turn = { role: 'user' | 'assistant'; content: string };

function parseBlock(block: string): { event: string; data: unknown } | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }
  if (!data.length) return null;
  try {
    return { event, data: JSON.parse(data.join('\n')) };
  } catch {
    return null;
  }
}

/** Ask the copilot; `delta` receives text as it is written, `meta` arrives before the first token. */
export async function streamAsk(question: string, history: Turn[], on: { meta?: (m: HawkMeta) => void; delta: (t: string) => void }, signal?: AbortSignal): Promise<HawkMeta | null> {
  const res = await fetch('/api/ai/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, history, stream: true }),
    signal,
  });
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(d.error ?? 'The hawk could not answer.');
  }
  if (!res.body || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const d = (await res.json()) as HawkMeta & { answer?: string };
    on.meta?.(d);
    on.delta(d.answer ?? '');
    return d;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let meta: HawkMeta | null = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf('\n\n');
    while (idx !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const ev = parseBlock(block);
      if (ev?.event === 'meta') {
        meta = ev.data as HawkMeta;
        on.meta?.(meta);
      } else if (ev?.event === 'delta') {
        on.delta(String((ev.data as { t?: string }).t ?? ''));
      } else if (ev?.event === 'error') {
        throw new Error(String((ev.data as { message?: string }).message ?? 'The answer was cut off.'));
      }
      idx = buffer.indexOf('\n\n');
    }
  }
  return meta;
}

/** A recorded question as text. */
export async function transcribe(blob: Blob): Promise<string> {
  const res = await fetch('/api/ai/transcribe', { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob });
  const d = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok) throw new Error(d.error ?? 'Could not hear that.');
  return (d.text ?? '').trim();
}
