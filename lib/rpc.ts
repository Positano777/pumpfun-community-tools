/**
 * Server-side Solana JSON-RPC client with provider failover, a per-isolate
 * request budget and 429 backoff.
 *
 * Provider chain (first healthy answer wins), resolved from Worker secrets so
 * endpoint tokens never reach the browser:
 *   QUICKNODE_RPC_URL  dedicated RugHawk endpoint (capped at 20 rps on the
 *                      QuickNode side so a scan burst can never starve the
 *                      account's other production endpoints)
 *   HELIUS_RPC_URL     optional failover
 *   ANKR_RPC_URL       optional failover
 *   public cluster     last resort (rate-limits hard and 403s Cloudflare egress)
 *
 * The budget limiter keeps one scan under the endpoint cap instead of
 * discovering it through 429s; a 429 still backs off and retries the same
 * provider before rolling over, because the next provider is usually worse.
 */

export interface RpcUpstream {
  name: string;
  url: string;
}

export class RpcError extends Error {
  constructor(
    message: string,
    public code?: number,
    public provider?: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export const PUBLIC_MAINNET_RPC = 'https://api.mainnet-beta.solana.com';

type Env = Record<string, unknown>;

export function rpcUpstreams(env: Env): RpcUpstream[] {
  const chain: RpcUpstream[] = [];
  const add = (name: string, value: unknown) => {
    if (typeof value === 'string' && value.startsWith('http')) chain.push({ name, url: value });
  };
  add('quicknode', env.QUICKNODE_RPC_URL);
  add('helius', env.HELIUS_RPC_URL);
  add('ankr', env.ANKR_RPC_URL);
  chain.push({ name: 'public', url: PUBLIC_MAINNET_RPC });
  return chain;
}

/** Token bucket: `rate` requests per second, bursts up to `rate`. */
class Budget {
  private tokens: number;
  private last = Date.now();
  private queue: (() => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private rate: number) {
    this.tokens = rate;
  }

  take(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.drain();
    });
  }

  private drain() {
    const now = Date.now();
    this.tokens = Math.min(this.rate, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    while (this.queue.length && this.tokens >= 1) {
      this.tokens -= 1;
      this.queue.shift()!();
    }
    if (this.queue.length && !this.timer) {
      const wait = Math.ceil(((1 - this.tokens) / this.rate) * 1000);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.drain();
      }, Math.max(wait, 10));
    }
  }
}

export interface RpcOptions {
  /** Requests per second this client may spend (default 15, under the 20 rps endpoint cap). */
  rate?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class SolanaRpc {
  private budget: Budget;
  private timeoutMs: number;
  private fetchImpl: typeof fetch;
  /** Calls made by this client; reported in scan metadata for cost tracking. */
  calls = 0;
  /** Provider that answered the most recent call. */
  lastProvider: string | null = null;

  constructor(
    private upstreams: RpcUpstream[],
    opts: RpcOptions = {},
  ) {
    if (!upstreams.length) throw new Error('No RPC upstreams configured');
    this.budget = new Budget(opts.rate ?? 15);
    this.timeoutMs = opts.timeoutMs ?? 12_000;
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
  }

  async call<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    let lastError: unknown = null;
    for (const upstream of this.upstreams) {
      for (let attempt = 0; attempt < 3; attempt++) {
        await this.budget.take();
        this.calls++;
        try {
          const res = await this.fetchImpl(upstream.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: this.calls, method, params }),
            signal: AbortSignal.timeout(this.timeoutMs),
          });
          if (res.status === 429) {
            lastError = new RpcError(`${upstream.name} rate limited`, 429, upstream.name);
            await sleep(250 * 2 ** attempt);
            continue;
          }
          if (res.status >= 500 || res.status === 403 || res.status === 401) {
            lastError = new RpcError(`${upstream.name} answered ${res.status}`, res.status, upstream.name);
            break; // next provider
          }
          const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
          if (body.error) {
            // Node-side throttling surfaces as a JSON-RPC error on some providers.
            if (/rate|limit|too many/i.test(body.error.message) && attempt < 2) {
              lastError = new RpcError(body.error.message, body.error.code, upstream.name);
              await sleep(250 * 2 ** attempt);
              continue;
            }
            throw new RpcError(body.error.message, body.error.code, upstream.name);
          }
          this.lastProvider = upstream.name;
          return body.result as T;
        } catch (e) {
          if (e instanceof RpcError && e.code !== 429 && e.provider === upstream.name && !/rate|limit/i.test(e.message)) {
            // A genuine JSON-RPC application error: every provider would say the same.
            throw e;
          }
          lastError = e;
          if (attempt < 2 && isTransient(e)) {
            await sleep(200 * 2 ** attempt);
            continue;
          }
          break;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new RpcError(`All RPC providers failed for ${method}`);
  }

  /** getMultipleAccounts in chunks of 100 (the RPC maximum). */
  async getMultipleAccounts<T = unknown>(addresses: string[], config: Record<string, unknown>): Promise<(T | null)[]> {
    const out: (T | null)[] = [];
    for (let i = 0; i < addresses.length; i += 100) {
      const chunk = addresses.slice(i, i + 100);
      const res = await this.call<{ value: (T | null)[] }>('getMultipleAccounts', [chunk, config]);
      out.push(...res.value);
    }
    return out;
  }

  /**
   * Highest transaction version the providers accept. Mainnet carries v1
   * transactions since 2026 (a v0 request for one fails with -32015), so ask
   * for v1 and step down once if a provider rejects the parameter itself.
   */
  private txVersion = 1;

  async getTransaction(signature: string): Promise<ParsedTx | null> {
    try {
      return await this.call<ParsedTx | null>('getTransaction', [
        signature,
        { encoding: 'jsonParsed', maxSupportedTransactionVersion: this.txVersion, commitment: 'confirmed' },
      ]);
    } catch (e) {
      if (this.txVersion > 0 && e instanceof RpcError && e.code === -32602) {
        this.txVersion = 0;
        return this.getTransaction(signature);
      }
      throw e;
    }
  }

  /** Fetch many transactions with bounded parallelism; failures come back as null. */
  async getTransactions(signatures: string[], parallel = 4): Promise<(ParsedTx | null)[]> {
    const out: (ParsedTx | null)[] = new Array(signatures.length).fill(null);
    let next = 0;
    const worker = async () => {
      while (next < signatures.length) {
        const i = next++;
        try {
          out[i] = await this.getTransaction(signatures[i]);
        } catch {
          out[i] = null;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(parallel, signatures.length) }, worker));
    return out;
  }

  /**
   * Walk an address's signature history backwards. Returns the signatures
   * newest-first and whether the very first signature was reached.
   */
  async signatureHistory(
    address: string,
    maxPages = 3,
    pageSize = 1000,
    startBefore?: string,
  ): Promise<{ sigs: SignatureInfo[]; reachedStart: boolean }> {
    const sigs: SignatureInfo[] = [];
    let before: string | undefined = startBefore;
    for (let page = 0; page < maxPages; page++) {
      const batch = await this.call<SignatureInfo[]>('getSignaturesForAddress', [
        address,
        { limit: pageSize, ...(before ? { before } : {}), commitment: 'confirmed' },
      ]);
      sigs.push(...batch);
      if (batch.length < pageSize) return { sigs, reachedStart: true };
      before = batch[batch.length - 1].signature;
    }
    return { sigs, reachedStart: false };
  }
}

export interface SignatureInfo {
  signature: string;
  slot: number;
  err: unknown;
  memo: string | null;
  blockTime: number | null;
}

export interface ParsedInstruction {
  programId: string;
  program?: string;
  parsed?: { type?: string; info?: Record<string, unknown> } | string;
  accounts?: string[];
  data?: string;
}

export interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount: { amount: string; decimals: number; uiAmount: number | null; uiAmountString?: string };
}

export interface ParsedTx {
  slot: number;
  blockTime: number | null;
  meta: {
    err: unknown;
    fee: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
    innerInstructions?: { index: number; instructions: ParsedInstruction[] }[];
    logMessages?: string[];
  } | null;
  transaction: {
    signatures: string[];
    message: {
      accountKeys: { pubkey: string; signer: boolean; writable: boolean; source?: string }[];
      instructions: ParsedInstruction[];
    };
  };
}

function isTransient(e: unknown): boolean {
  if (e instanceof RpcError) return e.code === 429 || (e.code ?? 0) >= 500;
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /timeout|abort|network|fetch failed|ECONNRESET|socket/i.test(msg);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** All instructions of a parsed transaction, outer and inner, flattened. */
export function allInstructions(tx: ParsedTx): ParsedInstruction[] {
  const outer = tx.transaction.message.instructions ?? [];
  const inner = (tx.meta?.innerInstructions ?? []).flatMap((i) => i.instructions);
  return [...outer, ...inner];
}

/** The fee payer (first signer) of a parsed transaction. */
export function feePayer(tx: ParsedTx): string | null {
  return tx.transaction.message.accountKeys[0]?.pubkey ?? null;
}

/** Programs invoked anywhere in a transaction. */
export function programsInvoked(tx: ParsedTx): Set<string> {
  return new Set(allInstructions(tx).map((i) => i.programId));
}
