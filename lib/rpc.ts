/**
 * Server-side Solana JSON-RPC client: two paid providers used side by side,
 * each for what it is good at, with per-provider request budgets, 429
 * backoff, provider cooldowns and failover.
 *
 * Providers (Worker secrets, so endpoint tokens never reach the browser):
 *   QUICKNODE_RPC_URL  archive node (getFirstAvailableBlock = 0). The only
 *                      provider allowed to answer history walks and the first
 *                      choice for index-heavy methods. The QuickNode account
 *                      cap is 50 rps shared with Solmint's production
 *                      endpoints, so RugHawk budgets 20 rps here by default.
 *   ANKR_RPC_URL       hot-state node. Measured 2026-10-08: same latency as
 *                      QuickNode on account reads and recent transactions, but
 *                      it keeps roughly 14 hours of ledger (an older getBlock
 *                      answers -32001 "cleaned up", getTransaction answers
 *                      null, getSignaturesForAddress answers [] for an old
 *                      wallet) and getTokenLargestAccounts took 13 to 20+ s.
 *                      It shares current-state traffic 50/50 with QuickNode
 *                      and takes recent transactions, never a history walk.
 *   HELIUS_RPC_URL     optional failover (treated as archival)
 *   public cluster     last resort (rate-limits hard and 403s Cloudflare egress)
 *
 * Routing by method class (see methodClass):
 *   state    account, balance, supply, blockhash and fee reads, simulate:
 *            balanced across every provider with weight > 0. The provider
 *            with budget to spare answers; round robin when both have it.
 *   history  getSignaturesForAddress and other ledger walks: archive providers
 *            only. A silently short answer from a pruned node would become a
 *            "fresh wallet" or "launch not found" finding.
 *   recent   getTransaction and getBlock with a known slot: balanced when the
 *            slot is inside a hot provider's retention window (probed with
 *            getFirstAvailableBlock, cached 10 minutes), archive otherwise.
 *            A null transaction from a hot provider is re-checked on an
 *            archive provider before it is believed.
 *   heavy    getTokenLargestAccounts, getProgramAccounts: primary first, hot
 *            providers only as failover.
 *   submit   sendTransaction: primary first for consistent landing.
 *
 * Budgets and cooldowns are per isolate and shared by every client in it, so
 * concurrent scans stay under the provider caps together.
 */

export interface RpcUpstream {
  name: string;
  url: string;
  /** Serves the full ledger (any slot). Hot nodes only keep recent blocks. */
  archive: boolean;
  /** Share of balanced traffic; 0 means failover only. */
  weight: number;
  /** Requests per second RugHawk may spend on this provider (per isolate). */
  rate: number;
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

function rateFrom(value: unknown, fallback: number): number {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function rpcUpstreams(env: Env): RpcUpstream[] {
  const chain: RpcUpstream[] = [];
  const add = (name: string, value: unknown, shape: Omit<RpcUpstream, 'name' | 'url'>) => {
    if (typeof value === 'string' && value.startsWith('http')) chain.push({ name, url: value, ...shape });
  };
  add('quicknode', env.QUICKNODE_RPC_URL, { archive: true, weight: 1, rate: rateFrom(env.QUICKNODE_RPC_RPS, 20) });
  add('ankr', env.ANKR_RPC_URL, { archive: false, weight: 1, rate: rateFrom(env.ANKR_RPC_RPS, 20) });
  add('helius', env.HELIUS_RPC_URL, { archive: true, weight: 0, rate: 10 });
  chain.push({ name: 'public', url: PUBLIC_MAINNET_RPC, archive: false, weight: 0, rate: 2 });
  return chain;
}

export type MethodClass = 'state' | 'history' | 'recent' | 'heavy' | 'submit';

const HISTORY_METHODS = new Set(['getSignaturesForAddress', 'getConfirmedSignaturesForAddress2', 'getBlocks', 'getBlocksWithLimit']);
const HEAVY_METHODS = new Set(['getTokenLargestAccounts', 'getProgramAccounts', 'getLargestAccounts', 'getSupply', 'getTokenAccountsByDelegate']);
const SUBMIT_METHODS = new Set(['sendTransaction']);
/** Methods whose slot the router can read from the params when the caller gives no hint. */
const RECENT_SLOT_PARAM: Record<string, number | null> = { getTransaction: null, getBlock: 0, getBlockTime: 0 };

export function methodClass(method: string): MethodClass {
  if (HISTORY_METHODS.has(method)) return 'history';
  if (method in RECENT_SLOT_PARAM) return 'recent';
  if (HEAVY_METHODS.has(method)) return 'heavy';
  if (SUBMIT_METHODS.has(method)) return 'submit';
  return 'state';
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

  /** Requests that could start right now without waiting. */
  available(): number {
    this.refill();
    return this.queue.length ? 0 : Math.floor(this.tokens);
  }

  get queued(): number {
    return this.queue.length;
  }

  private refill() {
    const now = Date.now();
    this.tokens = Math.min(this.rate, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
  }

  private drain() {
    this.refill();
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

interface ProviderState {
  budget: Budget;
  rate: number;
  cooldownUntil: number;
  /** Oldest slot a hot provider still serves; null while unknown or unprobed. */
  firstSlot: number | null;
  firstSlotCheckedAt: number;
  firstSlotProbe: Promise<void> | null;
}

const providers = new Map<string, ProviderState>();
let roundRobin = 0;

function stateFor(u: RpcUpstream): ProviderState {
  let s = providers.get(u.url);
  if (!s || s.rate !== u.rate) {
    s = { budget: new Budget(u.rate), rate: u.rate, cooldownUntil: 0, firstSlot: null, firstSlotCheckedAt: 0, firstSlotProbe: null };
    providers.set(u.url, s);
  }
  return s;
}

/** Tests only: forget budgets, cooldowns and retention probes. */
export function resetRpcState(): void {
  providers.clear();
  roundRobin = 0;
}

/** Keep balanced traffic away from a provider for a while after it failed. */
export function noteFailure(u: RpcUpstream, ms = 10_000): void {
  const s = stateFor(u);
  s.cooldownUntil = Math.max(s.cooldownUntil, Date.now() + ms);
}

/** Round robin among the candidates that can start a request now; the rest follow as failover. */
function pick(cands: RpcUpstream[]): RpcUpstream[] {
  const ready = cands.filter((u) => stateFor(u).budget.available() >= 1);
  const base = ready.length ? ready : [...cands].sort((a, b) => stateFor(a).budget.queued - stateFor(b).budget.queued);
  const chosen = base[roundRobin++ % base.length];
  return [chosen, ...cands.filter((u) => u !== chosen)];
}

/**
 * Provider order for a method class: `pool` is every provider allowed to
 * answer; weighted, healthy providers go first (balanced classes rotate
 * among them), the rest follow in chain order as failover.
 */
function orderFor(pool: RpcUpstream[], balanced: boolean): RpcUpstream[] {
  const now = Date.now();
  const primary = pool.filter((u) => u.weight > 0 && stateFor(u).cooldownUntil <= now);
  const first = balanced && primary.length > 1 ? pick(primary) : primary;
  return [...first, ...pool.filter((u) => !first.includes(u))];
}

/**
 * Provider order for a relayed batch (no slot hints available): the strictest
 * method class in the batch decides.
 */
export function relayOrder(upstreams: RpcUpstream[], methods: string[]): RpcUpstream[] {
  const classes = new Set(methods.map(methodClass));
  const ledger = classes.has('history') || classes.has('recent');
  const archive = upstreams.filter((u) => u.archive);
  const pool = ledger && archive.length ? archive : upstreams;
  return orderFor(pool, classes.size === 1 && classes.has('state'));
}

/** Slots a hot provider must have beyond its oldest block before it is trusted with one (about 13 minutes). */
const RETENTION_MARGIN = 2_000;
const RETENTION_TTL = 10 * 60_000;

/** JSON-RPC errors that mean "this node does not have it", not "it does not exist". */
function providerLocal(code: number | undefined, upstream: RpcUpstream): boolean {
  if (code === -32001 || code === -32004 || code === -32011 || code === -32020) return true;
  // Skipped-slot answers are genuine on an archive node and pruning on a hot one.
  return !upstream.archive && (code === -32007 || code === -32009);
}

export interface RpcOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface CallOptions {
  /** Slot the data lives in, so a recent transaction may go to a hot provider. */
  slot?: number | null;
  /** Force archive providers (used to re-check a null from a hot provider). */
  archiveOnly?: boolean;
}

export interface SignatureRef {
  signature: string;
  slot?: number | null;
}

export class SolanaRpc {
  private timeoutMs: number;
  private fetchImpl: typeof fetch;
  /** Requests sent by this client (every attempt); reported in scan metadata for cost tracking. */
  calls = 0;
  /** The same count per provider. */
  callsByProvider: Record<string, number> = {};
  /** Provider that answered the most recent call. */
  lastProvider: string | null = null;

  constructor(
    private upstreams: RpcUpstream[],
    opts: RpcOptions = {},
  ) {
    if (!upstreams.length) throw new Error('No RPC upstreams configured');
    this.timeoutMs = opts.timeoutMs ?? 12_000;
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
  }

  /** Per-provider call counts so far (copy). */
  snapshot(): Record<string, number> {
    return { ...this.callsByProvider };
  }

  /** Per-provider calls made since `snapshot()`. */
  since(snapshot: Record<string, number>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, n] of Object.entries(this.callsByProvider)) {
      const d = n - (snapshot[name] ?? 0);
      if (d > 0) out[name] = d;
    }
    return out;
  }

  private count(u: RpcUpstream) {
    this.calls++;
    this.callsByProvider[u.name] = (this.callsByProvider[u.name] ?? 0) + 1;
  }

  private hasArchive(): boolean {
    return this.upstreams.some((u) => u.archive);
  }

  private isArchive(name: string | null): boolean {
    return Boolean(this.upstreams.find((u) => u.name === name)?.archive);
  }

  /** Whether a hot provider still holds `slot`; probes and caches its oldest block. */
  private async covers(u: RpcUpstream, slot: number | null | undefined): Promise<boolean> {
    if (u.archive) return true;
    if (!u.weight || slot === null || slot === undefined) return false;
    const s = stateFor(u);
    if (Date.now() - s.firstSlotCheckedAt > RETENTION_TTL) {
      s.firstSlotProbe ??= this.probeFirstSlot(u, s);
      await s.firstSlotProbe;
    }
    return s.firstSlot !== null && slot >= s.firstSlot + RETENTION_MARGIN;
  }

  private async probeFirstSlot(u: RpcUpstream, s: ProviderState): Promise<void> {
    try {
      this.count(u);
      const res = await this.fetchImpl(u.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getFirstAvailableBlock', params: [] }),
        signal: AbortSignal.timeout(3000),
      });
      const body = (await res.json()) as { result?: unknown };
      s.firstSlot = typeof body.result === 'number' ? body.result : null;
    } catch {
      s.firstSlot = null;
    } finally {
      s.firstSlotCheckedAt = Date.now();
      s.firstSlotProbe = null;
    }
  }

  private async order(method: string, params: unknown[], opts: CallOptions): Promise<RpcUpstream[]> {
    const cls = methodClass(method);
    const paramIndex = RECENT_SLOT_PARAM[method];
    const fromParams = typeof paramIndex === 'number' && typeof params[paramIndex] === 'number' ? (params[paramIndex] as number) : undefined;
    const slot = opts.slot ?? fromParams;
    let pool: RpcUpstream[];
    if (cls === 'history' || opts.archiveOnly) {
      pool = this.upstreams.filter((u) => u.archive);
    } else if (cls === 'recent') {
      pool = [];
      for (const u of this.upstreams) if (await this.covers(u, slot)) pool.push(u);
    } else {
      pool = this.upstreams;
    }
    // Nothing archival configured (local dev without secrets): use what exists.
    if (!pool.length) pool = this.upstreams;
    return orderFor(pool, cls === 'state' || cls === 'recent');
  }

  async call<T = unknown>(method: string, params: unknown[] = [], opts: CallOptions = {}): Promise<T> {
    const order = await this.order(method, params, opts);
    let lastError: unknown = null;
    for (const upstream of order) {
      const state = stateFor(upstream);
      for (let attempt = 0; attempt < 3; attempt++) {
        await state.budget.take();
        this.count(upstream);
        try {
          const res = await this.fetchImpl(upstream.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: this.calls, method, params }),
            signal: AbortSignal.timeout(this.timeoutMs),
          });
          if (res.status === 429) {
            lastError = new RpcError(`${upstream.name} rate limited`, 429, upstream.name);
            if (attempt < 2) {
              await sleep(250 * 2 ** attempt);
              continue;
            }
            noteFailure(upstream, 3000);
            break; // next provider
          }
          if (res.status >= 500 || res.status === 403 || res.status === 401) {
            lastError = new RpcError(`${upstream.name} answered ${res.status}`, res.status, upstream.name);
            noteFailure(upstream, 10_000);
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
            if (providerLocal(body.error.code, upstream)) {
              lastError = new RpcError(`${upstream.name}: ${body.error.message}`, body.error.code, upstream.name);
              break; // next provider has the data
            }
            throw new RpcError(body.error.message, body.error.code, upstream.name);
          }
          this.lastProvider = upstream.name;
          return body.result as T;
        } catch (e) {
          if (e instanceof RpcError && e.provider === upstream.name && !isTransient(e) && !/rate|limit/i.test(e.message)) {
            // A genuine JSON-RPC application error: every provider would say the same.
            throw e;
          }
          lastError = e;
          // A timeout is usually the query, not the provider: move on, do not retry it.
          if (isTimeout(e)) break;
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

  /**
   * One parsed transaction. Pass the slot when you have it (signature lists
   * carry it): a recent transaction can then be served by the hot provider.
   */
  async getTransaction(signature: string, slot?: number | null): Promise<ParsedTx | null> {
    const params = [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: this.txVersion, commitment: 'confirmed' }];
    try {
      const tx = await this.call<ParsedTx | null>('getTransaction', params, { slot });
      // A hot provider answers null for anything it has pruned: confirm on an archive node.
      if (tx === null && !this.isArchive(this.lastProvider) && this.hasArchive()) {
        return await this.call<ParsedTx | null>('getTransaction', params, { slot, archiveOnly: true });
      }
      return tx;
    } catch (e) {
      if (this.txVersion > 0 && e instanceof RpcError && e.code === -32602) {
        this.txVersion = 0;
        return this.getTransaction(signature, slot);
      }
      throw e;
    }
  }

  /** Fetch many transactions with bounded parallelism; failures come back as null. */
  async getTransactions(items: (string | SignatureRef)[], parallel = 4): Promise<(ParsedTx | null)[]> {
    const refs: SignatureRef[] = items.map((i) => (typeof i === 'string' ? { signature: i } : i));
    const out: (ParsedTx | null)[] = new Array(refs.length).fill(null);
    let next = 0;
    const worker = async () => {
      while (next < refs.length) {
        const i = next++;
        try {
          out[i] = await this.getTransaction(refs[i].signature, refs[i].slot);
        } catch {
          out[i] = null;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(parallel, refs.length) }, worker));
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

function isTimeout(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /timeout|abort/i.test(msg);
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
