import type { FundingHop } from './types';
import type { ScanContext } from './context';
import { cached } from './context';
import type { ParsedTx, SignatureInfo } from '../rpc';
import { allInstructions, feePayer } from '../rpc';
import { isPda } from '../solana/address';
import { KNOWN_PROGRAMS } from '../solana/known';

const LAMPORTS = 1_000_000_000;

export interface AddressHistory {
  sigs: SignatureInfo[];
  reachedStart: boolean;
  balanceSol: number | null;
}

export async function addressHistory(ctx: ScanContext, address: string, maxPages = 2): Promise<AddressHistory> {
  const [{ sigs, reachedStart }, balance] = await Promise.all([
    ctx.rpc.signatureHistory(address, maxPages),
    ctx.rpc.call<{ value: number }>('getBalance', [address, { commitment: 'confirmed' }]).catch(() => null),
  ]);
  return { sigs, reachedStart, balanceSol: balance ? balance.value / LAMPORTS : null };
}

/**
 * Heuristic for exchange and market-maker hot wallets, which fund thousands
 * of unrelated wallets: a large SOL float or a full page of 1,000 signatures
 * inside two days. Measured in our field study: a "funder" that looked like an
 * insider held 1.34M SOL and did 15 withdrawals a minute; it was an exchange.
 */
export function looksLikeExchange(h: AddressHistory): boolean {
  if ((h.balanceSol ?? 0) >= 2_000) return true;
  if (!h.reachedStart && h.sigs.length >= 1000) {
    const newest = h.sigs[0]?.blockTime;
    const oldest = h.sigs[h.sigs.length - 1]?.blockTime;
    if (newest && oldest && newest - oldest < 172_800) return true;
  }
  return false;
}

/** Who sent `address` SOL in this transaction, and how much. */
export function inflowSource(tx: ParsedTx, address: string): { source: string | null; lamports: number | null } {
  for (const ix of allInstructions(tx)) {
    if (typeof ix.parsed !== 'object' || !ix.parsed?.info) continue;
    const info = ix.parsed.info as Record<string, unknown>;
    const type = ix.parsed.type;
    if (type === 'transfer' && info.destination === address && typeof info.lamports === 'number') {
      return { source: String(info.source), lamports: info.lamports };
    }
    if ((type === 'createAccount' || type === 'createAccountWithSeed') && info.newAccount === address) {
      return { source: String(info.source), lamports: typeof info.lamports === 'number' ? info.lamports : null };
    }
    if (type === 'transferWithSeed' && info.destination === address) {
      return { source: String(info.source), lamports: typeof info.lamports === 'number' ? info.lamports : null };
    }
  }
  // Fallback: the fee payer of a transaction that raised this account's balance.
  const keys = tx.transaction.message.accountKeys;
  const idx = keys.findIndex((k) => k.pubkey === address);
  if (idx >= 0 && tx.meta) {
    const delta = (tx.meta.postBalances[idx] ?? 0) - (tx.meta.preBalances[idx] ?? 0);
    const payer = feePayer(tx);
    if (delta > 0 && payer && payer !== address) return { source: payer, lamports: delta };
  }
  return { source: null, lamports: null };
}

/**
 * Follow first-funding links backwards: address <- funder <- funder's funder.
 * Stops at an exchange-like wallet, a program/PDA, a deep history it cannot
 * reach the start of, or after `maxHops`. Each hop is cached for a day:
 * first-funding is immutable history.
 */
export async function traceFunding(ctx: ScanContext, start: string, maxHops = 3, startHistory?: AddressHistory): Promise<FundingHop[]> {
  const hops: FundingHop[] = [];
  let current: string | null = start;
  const seen = new Set<string>();
  for (let hop = 0; hop < maxHops && current && !seen.has(current); hop++) {
    seen.add(current);
    const addr: string = current;
    const node = await cached(ctx, `fund:v1:${addr}`, 86_400, async () => fundingNode(ctx, addr, hop === 0 ? startHistory : undefined));
    hops.push(node);
    if (node.kind !== 'wallet' || !node.fundedBy) break;
    current = node.fundedBy;
  }
  // Classify the last funder too, so the chain ends on a labelled node.
  const last = hops[hops.length - 1];
  if (last?.fundedBy && !seen.has(last.fundedBy) && hops.length < maxHops + 1 && last.kind === 'wallet') {
    const h = await addressHistory(ctx, last.fundedBy, 1).catch(() => null);
    if (h) {
      hops.push({
        address: last.fundedBy,
        fundedBy: null,
        amountSol: null,
        time: null,
        signature: null,
        kind: looksLikeExchange(h) ? 'exchange-like' : isPda(last.fundedBy) ? 'pda' : 'wallet',
        balanceSol: h.balanceSol,
        firstSeen: h.reachedStart ? h.sigs[h.sigs.length - 1]?.blockTime ?? null : null,
        note: looksLikeExchange(h) ? 'High-volume hot wallet (exchange or market maker)' : 'Trace depth limit reached',
      });
    }
  }
  return hops;
}

async function fundingNode(ctx: ScanContext, address: string, known?: AddressHistory): Promise<FundingHop> {
  const base: FundingHop = { address, fundedBy: null, amountSol: null, time: null, signature: null, kind: 'unknown', balanceSol: null, firstSeen: null };
  if (KNOWN_PROGRAMS[address]) return { ...base, kind: 'program', note: KNOWN_PROGRAMS[address].name };
  if (isPda(address)) return { ...base, kind: 'pda', note: 'Program-controlled account' };
  const h = known ?? (await addressHistory(ctx, address, 2));
  base.balanceSol = h.balanceSol;
  if (looksLikeExchange(h)) return { ...base, kind: 'exchange-like', note: 'High-volume hot wallet (exchange or market maker)' };
  if (!h.reachedStart || !h.sigs.length) return { ...base, kind: 'wallet', note: 'History too deep to reach first funding' };
  const first = [...h.sigs].reverse().find((s) => !s.err) ?? h.sigs[h.sigs.length - 1];
  base.firstSeen = first.blockTime ?? null;
  const tx = await ctx.rpc.getTransaction(first.signature, first.slot);
  if (!tx) return { ...base, kind: 'wallet' };
  const { source, lamports } = inflowSource(tx, address);
  return {
    ...base,
    kind: 'wallet',
    fundedBy: source,
    amountSol: lamports !== null ? lamports / LAMPORTS : null,
    time: tx.blockTime ?? first.blockTime ?? null,
    signature: first.signature,
  };
}
