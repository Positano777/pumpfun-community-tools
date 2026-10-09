/**
 * Cloudflare bindings and secrets, typed for what RugHawk uses. Resolved from
 * the OpenNext request context in production, with a process.env fallback so
 * the same modules run under `next dev` and the CLI.
 */

export interface AiBinding {
  run(model: string, input: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  websearch?(params: { gatewayId: string; query: string; provider?: string; limit?: number }): Promise<Response>;
}

export interface KVLike {
  get(key: string, type: 'json'): Promise<unknown>;
  getWithMetadata?(key: string, type: 'arrayBuffer'): Promise<{ value: ArrayBuffer | null; metadata: unknown }>;
  put(key: string, value: string | ArrayBuffer, opts?: { expirationTtl?: number; metadata?: Record<string, unknown> }): Promise<void>;
}

export interface D1Statement {
  bind(...args: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface D1Like {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown>;
}

export interface R2Like {
  put(key: string, value: ArrayBuffer | string | ReadableStream, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null>;
}

export interface VectorizeLike {
  upsert(vectors: { id: string; values: number[]; metadata?: Record<string, unknown> }[]): Promise<unknown>;
  query(vector: number[], opts: { topK: number; returnMetadata?: 'all' | 'indexed' | 'none' | boolean }): Promise<{ matches: { id: string; score: number; metadata?: Record<string, unknown> }[] }>;
}

export interface BrowserLike {
  quickAction(action: string, params: Record<string, unknown>): Promise<unknown>;
}

export interface AiSearchInstance {
  search(params: Record<string, unknown>): Promise<{ chunks?: { text?: string; content?: string; item?: { key?: string; filename?: string }; score?: number }[] }>;
  items: { uploadAndPoll(name: string, content: string): Promise<{ status?: string }>; upload(name: string, content: string): Promise<unknown> };
}

export interface AiSearchNamespace {
  get(id: string): AiSearchInstance;
  create(params: { id: string } & Record<string, unknown>): Promise<AiSearchInstance>;
  list(): Promise<{ result: { id: string; status?: string }[] }>;
}

export interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface AppEnv {
  AI?: AiBinding;
  CACHE?: KVLike;
  DB?: D1Like;
  REPORTS?: R2Like;
  DNA?: VectorizeLike;
  BROWSER?: BrowserLike;
  AI_SEARCH?: AiSearchNamespace;
  QUICKNODE_RPC_URL?: string;
  HELIUS_RPC_URL?: string;
  ANKR_RPC_URL?: string;
  /** Optional per-isolate request budgets (requests per second, default 20 each). */
  QUICKNODE_RPC_RPS?: string;
  ANKR_RPC_RPS?: string;
  AI_GATEWAY_ID?: string;
  AI_SEARCH_INSTANCE?: string;
  ADMIN_TOKEN?: string;
  NEXT_PUBLIC_APP_URL?: string;
  [key: string]: unknown;
}

export interface ExecutionCtx {
  waitUntil(p: Promise<unknown>): void;
}

export async function getEnv(): Promise<{ env: AppEnv; ctx: ExecutionCtx | null }> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const cf = (await getCloudflareContext({ async: true })) as unknown as { env: AppEnv; ctx?: ExecutionCtx };
    return { env: { ...(process.env as AppEnv), ...cf.env }, ctx: cf.ctx ?? null };
  } catch {
    return { env: process.env as AppEnv, ctx: null };
  }
}

/** Keep work alive after the response; a Worker cancels un-awaited promises. */
export function afterResponse(ctx: ExecutionCtx | null, work: Promise<unknown>): Promise<void> | void {
  const safe = work.catch((e) => console.error('[rughawk] deferred work failed:', e instanceof Error ? e.message : e));
  if (ctx?.waitUntil) ctx.waitUntil(safe);
  else return safe.then(() => undefined);
}
