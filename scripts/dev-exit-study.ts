/**
 * Dev-exit study: how often the deployer of a dead pump.fun launch sells its
 * launch buy, and how fast.
 *
 *   npm run study -- [fromHoursAgo=24] [toHoursAgo=6] [deadLaunches=30] [seed] [out.json]
 *
 * Method:
 *   1. Creation feed. pump.fun's mint-authority PDA takes part in every token
 *      creation and in nothing else, so its signature history is the list of
 *      creations. Every successful creation in the window is collected.
 *   2. Random sample. The window is shuffled with a seeded generator (the seed
 *      is printed, so a run can be repeated exactly) and walked in that order.
 *   3. Dead launches only. Kept: not graduated, no transaction on the mint for
 *      the last IDLE_HOURS, and under DEAD_CURVE_SOL left in the bonding curve.
 *   4. Each kept launch goes through the RugHawk launch module (the same code
 *      that runs in production), whose outflow classifier separates sales from
 *      locks, burns and transfers. Only a sale counts as an exit.
 *
 * Reads the RPC endpoints from .dev.vars, like scan-cli.
 */
import { writeFileSync } from 'node:fs';
import { PublicKey } from '@solana/web3.js';
import { SolanaRpc, allInstructions, feePayer, rpcUpstreams, type ParsedTx, type SignatureInfo } from '../lib/rpc';
import { MemoryCache, type ScanContext } from '../lib/scan/context';
import { analyzeLaunch } from '../lib/scan/launch';
import { fetchMint } from '../lib/scan/token';
import { TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from '../lib/solana/known';
import { base64ToBytes } from '../lib/solana/address';
import { loadDevVars } from './dev-vars';

const PUMP_FUN = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const IDLE_HOURS = 3;
const DEAD_CURVE_SOL = 1;

const [fromArg, toArg, wantArg, seedArg, out] = process.argv.slice(2);
const fromHours = Number(fromArg ?? 24);
const toHours = Number(toArg ?? 6);
const want = Number(wantArg ?? 30);
const seed = Number(seedArg ?? Math.floor(Math.random() * 1e9));

const env = { ...process.env, ...loadDevVars() };
const ctx: ScanContext = {
  rpc: new SolanaRpc(rpcUpstreams(env)),
  cache: new MemoryCache(),
  fetch: (...a) => fetch(...a),
  now: () => Date.now(),
};

/** mulberry32: small seeded generator, so a sample can be drawn again. */
function seeded(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function u64(bytes: Uint8Array, offset: number): number {
  let v = BigInt(0);
  for (let i = 7; i >= 0; i--) v = (v << BigInt(8)) | BigInt(bytes[offset + i]);
  return Number(v);
}

function createdMint(tx: ParsedTx): string | null {
  for (const i of allInstructions(tx)) {
    const p = typeof i.parsed === 'object' ? i.parsed : null;
    if ((i.programId === TOKEN_PROGRAM || i.programId === TOKEN_2022_PROGRAM) && p && /^initializeMint/.test(p.type ?? '')) {
      const mint = p.info?.mint;
      if (typeof mint === 'string') return mint;
    }
  }
  return null;
}

/** Bonding curve: real SOL reserves at offset 32, `complete` at 48 (layout used by lib/scan/launch.ts). */
async function curveState(mint: string): Promise<{ realSol: number; complete: boolean } | null> {
  const [curve] = PublicKey.findProgramAddressSync([new TextEncoder().encode('bonding-curve'), new PublicKey(mint).toBytes()], PUMP_FUN);
  const res = await ctx.rpc.call<{ value: { owner: string; data: [string, string] } | null }>('getAccountInfo', [curve.toBase58(), { encoding: 'base64' }]);
  if (!res.value || res.value.owner !== PUMP_FUN.toBase58()) return null;
  const bytes = base64ToBytes(res.value.data[0]);
  if (bytes.length < 81) return null;
  return { realSol: u64(bytes, 32) / 1e9, complete: bytes[48] === 1 };
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

const [authority] = PublicKey.findProgramAddressSync([new TextEncoder().encode('mint-authority')], PUMP_FUN);
const now = Math.floor(Date.now() / 1000);
const from = now - fromHours * 3600;
const to = now - toHours * 3600;
console.log(`creation feed: ${authority.toBase58()}  window ${new Date(from * 1000).toISOString()} .. ${new Date(to * 1000).toISOString()}  seed ${seed}`);

// 1. Every successful creation in the window.
const windowSigs: SignatureInfo[] = [];
let before: string | undefined;
for (let page = 0; page < 400; page++) {
  const batch = await ctx.rpc.call<SignatureInfo[]>('getSignaturesForAddress', [authority.toBase58(), { limit: 1000, ...(before ? { before } : {}) }]);
  if (!batch.length) break;
  for (const s of batch) if (!s.err && s.blockTime && s.blockTime >= from && s.blockTime < to) windowSigs.push(s);
  before = batch[batch.length - 1].signature;
  if ((batch[batch.length - 1].blockTime ?? 0) < from) break;
}
console.log(`creations in window: ${windowSigs.length}`);

// 2. Seeded shuffle.
const rand = seeded(seed);
const order = windowSigs.map((s) => ({ s, k: rand() })).sort((a, b) => a.k - b.k).map((x) => x.s);

interface Row {
  mint: string;
  createdAt: number | null;
  deployer: string | null;
  devBuyPct: number | null;
  sold: boolean;
  firstSaleSeconds: number | null;
  soldPctOfSupply: number;
  soldShareOfBag: number | null;
  locks: number;
  burns: number;
  transfers: number;
  devNowPct: number | null;
  curveSol: number;
  idleHours: number;
}

// 3 and 4. Walk the sample until enough dead launches are read.
const rows: Row[] = [];
const skipped = { graduated: 0, alive: 0, unreadable: 0 };
let checked = 0;
for (const s of order) {
  if (rows.length >= want || checked >= want * 8) break;
  checked++;
  try {
    const tx = await ctx.rpc.getTransaction(s.signature, s.slot);
    const mint = tx ? createdMint(tx) : null;
    const curve = mint ? await curveState(mint) : null;
    if (!tx || !mint || !curve) {
      skipped.unreadable++;
      continue;
    }
    if (curve.complete) {
      skipped.graduated++;
      continue;
    }
    const [newest] = await ctx.rpc.call<SignatureInfo[]>('getSignaturesForAddress', [mint, { limit: 1 }]);
    const idleHours = newest?.blockTime ? (now - newest.blockTime) / 3600 : Infinity;
    if (idleHours < IDLE_HOURS || curve.realSol >= DEAD_CURVE_SOL) {
      skipped.alive++;
      continue;
    }
    const parsed = await fetchMint(ctx, mint);
    const uiSupply = Number(parsed.supply) / 10 ** parsed.decimals;
    const payer = feePayer(tx);
    const { launch } = await analyzeLaunch(
      ctx,
      { mint, uiSupply, decimals: parsed.decimals, tokenProgram: parsed.program === 'spl-token-2022' ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM },
      async () => ({ candidates: payer ? [payer] : [], finishedCurve: null, approxTime: s.blockTime }),
    );
    if (!launch.reached || !launch.creationSignature) {
      skipped.unreadable++;
      continue;
    }
    const saleTimes = launch.devSells.map((x) => x.secondsAfterLaunch).filter((x): x is number => x !== null);
    const soldPct = launch.devSells.reduce((a, x) => a + x.pctOfSupply, 0);
    const row: Row = {
      mint,
      createdAt: launch.createdAt,
      deployer: launch.deployer,
      devBuyPct: launch.devInitialPct,
      sold: launch.devSells.length > 0,
      firstSaleSeconds: saleTimes.length ? Math.min(...saleTimes) : null,
      soldPctOfSupply: round(soldPct),
      soldShareOfBag: launch.devInitialPct ? round(Math.min(1, soldPct / launch.devInitialPct)) : null,
      locks: launch.devLocks.length,
      burns: launch.devBurns.length,
      transfers: launch.devTransfers.length,
      devNowPct: launch.devCurrentPct,
      curveSol: round(curve.realSol, 3),
      idleHours: Number.isFinite(idleHours) ? round(idleHours, 1) : -1,
    };
    rows.push(row);
    console.log(
      `${String(rows.length).padStart(2)} ${mint}  devBuy=${row.devBuyPct ?? '-'}%  ${row.sold ? `SOLD ${row.soldShareOfBag === null ? '?' : Math.round(row.soldShareOfBag * 100)}% of bag, first at +${row.firstSaleSeconds ?? '?'}s` : 'no sale'}  locks=${row.locks} burns=${row.burns} transfers=${row.transfers} devNow=${row.devNowPct ?? '-'}%`,
    );
  } catch (e) {
    skipped.unreadable++;
    console.warn(`skip ${s.signature.slice(0, 12)}: ${e instanceof Error ? e.message.slice(0, 120) : 'failed'}`);
  }
}

// Aggregate.
const withBag = rows.filter((r) => (r.devBuyPct ?? 0) > 0);
const sellers = withBag.filter((r) => r.sold);
const firstSales = sellers.map((r) => r.firstSaleSeconds).filter((x): x is number => x !== null);
const summary = {
  study: 'dev-exit on dead pump.fun launches',
  ranAt: new Date().toISOString(),
  window: { from: new Date(from * 1000).toISOString(), to: new Date(to * 1000).toISOString() },
  seed,
  definitionOfDead: `not graduated, no transaction for ${IDLE_HOURS}h, under ${DEAD_CURVE_SOL} SOL left in the curve`,
  creationsInWindow: windowSigs.length,
  candidatesChecked: checked,
  skipped,
  deadLaunchesRead: rows.length,
  withDevBuy: withBag.length,
  deployerSold: sellers.length,
  soldHalfOrMoreOfBag: sellers.filter((r) => (r.soldShareOfBag ?? 0) >= 0.5).length,
  firstSaleSecondsMedian: median(firstSales),
  firstSaleWithin60s: firstSales.filter((x) => x <= 60).length,
  lockedAny: withBag.filter((r) => r.locks > 0).length,
  burnedAny: withBag.filter((r) => r.burns > 0).length,
  transferredAny: withBag.filter((r) => r.transfers > 0).length,
  devBuyPctMedian: median(withBag.map((r) => r.devBuyPct ?? 0)),
  rpcCalls: ctx.rpc.calls,
};
console.log('\n' + JSON.stringify(summary, null, 2));
if (out) writeFileSync(out, JSON.stringify({ summary, launches: rows }, null, 2) + '\n');
