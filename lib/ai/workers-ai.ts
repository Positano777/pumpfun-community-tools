/**
 * Workers AI access, routed through AI Gateway for one place to see request
 * logs, token cost, cache hits and rate limits across every AI feature.
 *
 * Gateway chain: AI_GATEWAY_ID (create `rughawk-ai` in the dashboard to give
 * this app its own analytics and spend limit), then `default` (AI Gateway
 * creates it automatically on first use), then a direct call. A missing or
 * misconfigured gateway must never take a feature down.
 *
 * Model choices follow what Solmint measured live through its gateway on
 * 2026-09-10: Llama 4 Scout answered schema-constrained JSON in ~1.6 s with
 * valid output every run; Llama 3.3 70B is the fallback.
 */
import type { AiBinding } from '../env';
import { parseLooseJson } from './json';

export const MODELS = {
  text: '@cf/meta/llama-4-scout-17b-16e-instruct',
  textFallback: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  vision: '@cf/meta/llama-4-scout-17b-16e-instruct',
  embed: '@cf/baai/bge-base-en-v1.5',
  safety: '@cf/meta/llama-guard-3-8b',
  tts: '@cf/deepgram/aura-1',
  rerank: '@cf/baai/bge-reranker-base',
  transcribe: '@cf/openai/whisper-large-v3-turbo',
  translate: '@cf/meta/m2m100-1.2b',
} as const;

export interface GatewayOpts {
  cacheTtl?: number;
  label?: string;
}

export type AiPath = 'gateway' | 'default-gateway' | 'direct';

export function gatewayIds(configured: string | undefined): string[] {
  const ids = [configured, 'default'].filter((v): v is string => Boolean(v));
  return [...new Set(ids)];
}

export async function runModel(
  ai: AiBinding,
  model: string,
  input: Record<string, unknown>,
  gatewayId: string | undefined,
  opts: GatewayOpts = {},
  extra: Record<string, unknown> = {},
): Promise<{ result: unknown; path: AiPath }> {
  for (const id of gatewayIds(gatewayId)) {
    try {
      const result = await ai.run(model, input, {
        ...extra,
        gateway: { id, ...(opts.cacheTtl ? { cacheTtl: opts.cacheTtl } : {}), ...(opts.label ? { metadata: { feature: opts.label } } : {}) },
      });
      return { result, path: id === 'default' && gatewayId !== 'default' ? 'default-gateway' : 'gateway' };
    } catch {
      // try the next gateway, then direct
    }
  }
  return { result: await ai.run(model, input, extra), path: 'direct' };
}

/** Text out of any Workers AI response shape (string, {response}, OpenAI choices). */
export function extractText(result: unknown): string | null {
  if (typeof result === 'string') return result || null;
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  const direct = r.response ?? (r.result as Record<string, unknown> | undefined)?.response;
  if (typeof direct === 'string' && direct.length) return direct;
  if (direct && typeof direct === 'object') return JSON.stringify(direct);
  const content = (r.choices as { message?: { content?: unknown } }[] | undefined)?.[0]?.message?.content;
  if (typeof content === 'string' && content.length) return content;
  if (content && typeof content === 'object') return JSON.stringify(content);
  return null;
}

export interface StructuredRequest {
  system: string;
  user: string | unknown[];
  schema: Record<string, unknown>;
  maxTokens?: number;
  gateway?: GatewayOpts;
  model?: string;
}

/**
 * Schema-constrained generation (Workers AI JSON mode). Returns null instead
 * of throwing: an AI paragraph is never worth failing a security report.
 */
export async function generateStructured<T>(ai: AiBinding, gatewayId: string | undefined, req: StructuredRequest): Promise<{ data: T; model: string; path: AiPath } | null> {
  const input = {
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
    max_tokens: req.maxTokens ?? 900,
    response_format: { type: 'json_schema', json_schema: req.schema },
  };
  const primary = req.model ?? MODELS.text;
  const models = primary === MODELS.textFallback ? [primary] : [primary, MODELS.textFallback];
  for (const model of models) {
    try {
      const { result, path } = await runModel(ai, model, input, gatewayId, req.gateway);
      const text = extractText(result);
      const data = text ? parseLooseJson<T>(text) : null;
      if (data) return { data, model, path };
    } catch (e) {
      console.warn(`[ai] ${model} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return null;
}

export async function generateText(ai: AiBinding, gatewayId: string | undefined, messages: { role: string; content: unknown }[], maxTokens = 900, gateway?: GatewayOpts, model: string = MODELS.text): Promise<{ text: string; model: string } | null> {
  for (const m of model === MODELS.textFallback ? [model] : [model, MODELS.textFallback]) {
    try {
      const { result } = await runModel(ai, m, { messages, max_tokens: maxTokens }, gatewayId, gateway);
      const text = extractText(result);
      if (text) return { text, model: m };
    } catch (e) {
      console.warn(`[ai] ${m} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return null;
}

/**
 * Parse Workers AI server-sent events into text deltas. Returns the pieces
 * found, the unconsumed tail (a partial line) and whether [DONE] was seen.
 */
export function parseSse(buffer: string): { texts: string[]; rest: string; done: boolean } {
  const texts: string[] = [];
  let done = false;
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const payload = t.slice(5).trim();
    if (payload === '[DONE]') {
      done = true;
      continue;
    }
    try {
      const j = JSON.parse(payload) as { response?: unknown; choices?: { delta?: { content?: unknown } }[] };
      const piece = typeof j.response === 'string' ? j.response : typeof j.choices?.[0]?.delta?.content === 'string' ? j.choices[0].delta.content : '';
      if (piece) texts.push(piece);
    } catch {
      // a line that is not JSON (comments, keep-alives) carries no text
    }
  }
  return { texts, rest, done };
}

function textDeltas(bytes: ReadableStream<Uint8Array>): ReadableStream<string> {
  const reader = bytes.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return new ReadableStream<string>({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        for (const t of parseSse(`${buffer}\n`).texts) controller.enqueue(t);
        controller.close();
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSse(buffer);
      buffer = parsed.rest;
      for (const t of parsed.texts) controller.enqueue(t);
      if (parsed.done) {
        controller.close();
        await reader.cancel().catch(() => undefined);
      }
    },
    cancel() {
      return reader.cancel().catch(() => undefined);
    },
  });
}

/** Token-by-token generation; falls back to the secondary model, then to a one-chunk stream of a plain answer. */
export async function streamText(ai: AiBinding, gatewayId: string | undefined, messages: { role: string; content: unknown }[], maxTokens = 900, gateway?: GatewayOpts, model: string = MODELS.text): Promise<{ stream: ReadableStream<string>; model: string } | null> {
  for (const m of model === MODELS.textFallback ? [model] : [model, MODELS.textFallback]) {
    try {
      const { result } = await runModel(ai, m, { messages, max_tokens: maxTokens, stream: true }, gatewayId, gateway);
      if (result instanceof ReadableStream) return { stream: textDeltas(result as ReadableStream<Uint8Array>), model: m };
      const text = extractText(result);
      if (text) return { stream: once(text), model: m };
    } catch (e) {
      console.warn(`[ai] ${m} stream failed:`, e instanceof Error ? e.message : e);
    }
  }
  return null;
}

/** A finished answer as a one-chunk stream, so callers have a single code path. */
export function once(text: string): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      controller.enqueue(text);
      controller.close();
    },
  });
}
