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
