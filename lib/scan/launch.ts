import { PublicKey } from '@solana/web3.js';
import type { Finding, LaunchForensics } from './types';
import type { ScanContext } from './context';
import type { ParsedInstruction, ParsedTx, SignatureInfo, TokenBalance } from '../rpc';
import { allInstructions, feePayer, programsInvoked } from '../rpc';
import { KNOWN_PROGRAMS, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, WSOL_MINT } from '../solana/known';
import { pctText, plural } from '../format';
import { associatedTokenAddress, base64ToBytes, bytesToAddress, isAddress } from '../solana/address';

/**
 * Launch-window forensics, built on what our own field study measured on
 * trending pump.fun / LaunchLab launches (2026-09-20, 13 trending tokens plus
 * 70 control launches):
 *   - dev-buy-and-dump: 13 of 13 dead control launches saw the creator exit,
 *     median 7 seconds after launch
 *   - same-slot ramp buys by partner wallets inflate the first candle
 *   - creators who never sold were the only survivors at T+5h
 *
 * Everything is derived from transactions (fee payer, pre/post token
 * balances), never from a third-party label.
 *
 * Finding the creation transaction is the hard part: a hot launch crosses
 * 1,000 transactions in its first minutes, so walking the mint's history
 * backwards does not reach it. In that case the creator is discovered from
 * state (the pump.fun bonding curve stores it; metadata authorities and
 * creators are fallbacks) and the creation is located in the creator's much
 * shorter history, near the time DexScreener first saw the pair. Same-block
 * bundles are then read from the creation block itself.
 */
export interface LaunchInput {
  mint: string;
  uiSupply: number;
  decimals: number;
  /** SPL Token or Token-2022 program that owns the mint. */
  tokenProgram: string;
}

export interface LaunchHints {
  /** Addresses that may have signed the creation transaction. */
  candidates: string[];
  /** A graduated pump.fun curve: its first signature is the creation. */
  finishedCurve?: string | null;
  /** Unix seconds when the first pool/curve appeared (DexScreener), if known. */
  approxTime: number | null;
}

export interface LaunchResult {
  launch: LaunchForensics;
  findings: Finding[];
}

const PUMP_FUN = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

export interface PumpCurve {
  curve: string;
  creator: string | null;
  /** Graduated: the curve stopped trading, so its history is bounded. */
  complete: boolean;
}

/**
 * The pump.fun bonding curve for a mint: creator at offset 49 and the
 * `complete` flag at offset 48 (layout verified on mainnet 2026-10-07).
 */
export async function pumpFunCurve(ctx: ScanContext, mint: string): Promise<PumpCurve | null> {
  const [curve] = PublicKey.findProgramAddressSync([new TextEncoder().encode('bonding-curve'), new PublicKey(mint).toBytes()], PUMP_FUN);
  const res = await ctx.rpc.call<{ value: { owner: string; data: [string, string] } | null }>('getAccountInfo', [curve.toBase58(), { encoding: 'base64' }]);
  if (!res.value || res.value.owner !== PUMP_FUN.toBase58()) return null;
  const bytes = base64ToBytes(res.value.data[0]);
  if (bytes.length < 81) return null;
  const creator = bytesToAddress(bytes.slice(49, 81));
  return { curve: curve.toBase58(), creator: creator === '11111111111111111111111111111111' ? null : creator, complete: bytes[48] === 1 };
}

function createsMint(tx: ParsedTx, mint: string): boolean {
  return allInstructions(tx).some(
    (i) =>
      (i.programId === TOKEN_PROGRAM || i.programId === TOKEN_2022_PROGRAM) &&
      typeof i.parsed === 'object' &&
      /^initializeMint/.test(i.parsed?.type ?? '') &&
      i.parsed?.info?.mint === mint,
  );
}

export async function analyzeLaunch(ctx: ScanContext, input: LaunchInput, hints: () => Promise<LaunchHints>): Promise<LaunchResult> {
  const first = await ctx.rpc.signatureHistory(input.mint, 1);

  // Cheap path: the whole history fits in one page.
  if (first.reachedStart && first.sigs.length) {
    const chronological = [...first.sigs].reverse();
    const creationSig = chronological.find((s) => !s.err) ?? chronological[0];
    const creationTx = await ctx.rpc.getTransaction(creationSig.signature, creationSig.slot);
    if (!creationTx) return { launch: emptyLaunch(first.sigs.length), findings: [] };
    const early = chronological.filter((s) => s.signature !== creationSig.signature && !s.err && s.slot <= creationTx.slot + 1).slice(0, 15);
    const earlyTxs = early.length ? await ctx.rpc.getTransactions(early, 4) : [];
    return finish(ctx, input, creationSig.signature, creationTx, earlyTxs, first.sigs);
  }

  // Hot path: locate the creation through the creator's own history.
  const h = await hints();
  // PDAs stay in: a pump.fun creator can be a fee-sharing PDA, and the
  // creation still appears in its (short) history.
  const candidates = [...new Set(h.candidates.filter((c) => isAddress(c)))].slice(0, 3);
  const queue = [...candidates];
  const tried = new Set<string>();
  while (queue.length && tried.size < 4) {
    const candidate = queue.shift()!;
    if (tried.has(candidate)) continue;
    tried.add(candidate);
    const { found, sigs } = await findCreation(ctx, input.mint, candidate, h.approxTime);
    if (found) {
      const blockTxs = await creationBlockBuyers(ctx, input.mint, found.tx.slot, found.signature);
      // The candidate's history doubles as the deployer's only when it paid for the creation.
      return finish(ctx, input, found.signature, found.tx, blockTxs, null, feePayer(found.tx) === candidate ? found.creatorSigs : undefined);
    }
    // A candidate created after the launch (pump.fun fee-sharing PDAs are set
    // up seconds later) was paid for by the real deployer: follow its first
    // fee payer.
    if (sigs.length && sigs.length < 1000) {
      const oldest = [...sigs].reverse().find((s) => !s.err);
      const tx = oldest ? await ctx.rpc.getTransaction(oldest.signature, oldest.slot).catch(() => null) : null;
      const payer = tx ? feePayer(tx) : null;
      if (payer && !tried.has(payer)) queue.unshift(payer);
    }
  }

  // A graduated curve no longer trades, so its whole history is reachable.
  if (h.finishedCurve) {
    const curveHist = await ctx.rpc.signatureHistory(h.finishedCurve, 12).catch(() => null);
    if (curveHist?.reachedStart && curveHist.sigs.length) {
      const chronological = [...curveHist.sigs].reverse();
      const creationSig = chronological.find((s) => !s.err) ?? chronological[0];
      const creationTx = await ctx.rpc.getTransaction(creationSig.signature, creationSig.slot);
      if (creationTx && createsMint(creationTx, input.mint)) {
        const blockTxs = await creationBlockBuyers(ctx, input.mint, creationTx.slot, creationSig.signature);
        return finish(ctx, input, creationSig.signature, creationTx, blockTxs, null);
      }
    }
  }

  // Last resort: walk two more pages of the mint's own history.
  if (first.sigs.length) {
    const more = await ctx.rpc.signatureHistory(input.mint, 2, 1000, first.sigs[first.sigs.length - 1].signature).catch(() => null);
    if (more?.reachedStart && more.sigs.length) {
      const all = [...first.sigs, ...more.sigs];
      const chronological = [...all].reverse();
      const creationSig = chronological.find((s) => !s.err) ?? chronological[0];
      const creationTx = await ctx.rpc.getTransaction(creationSig.signature, creationSig.slot);
      if (creationTx) {
        const early = chronological.filter((s) => s.signature !== creationSig.signature && !s.err && s.slot <= creationTx.slot + 1).slice(0, 15);
        const earlyTxs = early.length ? await ctx.rpc.getTransactions(early, 4) : [];
        return finish(ctx, input, creationSig.signature, creationTx, earlyTxs, all);
      }
    }
  }

  // "Established" needs positive evidence of age: a pool older than three
  // days, or a first page of mint history that already spans three days.
  // Unknown age is unverified, never clean.
  const nowS = ctx.now() / 1000;
  const oldestSeen = first.sigs[first.sigs.length - 1]?.blockTime ?? null;
  const established =
    (h.approxTime !== null && nowS - h.approxTime >= 3 * 86_400) || (oldestSeen !== null && nowS - oldestSeen >= 3 * 86_400);
  return {
    launch: emptyLaunch(first.sigs.length),
    findings: [
      !established
        ? {
            id: 'LAUNCH_NOT_LOCATED',
            severity: 'medium',
            category: 'launch',
            title: 'Launch forensics could not be completed',
            detail: 'A young or undated token with heavy early volume whose creation transaction could not be located, so bundle and dev-sell checks did not run. Treat it as unverified, not as clean.',
            weight: 12,
          }
        : {
            id: 'LAUNCH_WINDOW_PASSED',
            severity: 'info',
            category: 'launch',
            title: 'Established token: launch forensics skipped',
            detail: 'Deep transaction history and an older market. Launch-window tricks (bundles, instant dev dumps) are no longer the live risk; holder and authority checks are.',
            weight: 0,
          },
    ],
  };
}

async function findCreation(
  ctx: ScanContext,
  mint: string,
  candidate: string,
  approxTime: number | null,
): Promise<{ found: { signature: string; tx: ParsedTx; creatorSigs: SignatureInfo[] } | null; sigs: SignatureInfo[] }> {
  // Busy creators (bots) keep trading after launch, so page back until the
  // history reaches the launch window or three pages are spent. Without a
  // launch time, page to the end of three pages and probe the oldest.
  const sigs: SignatureInfo[] = [];
  let before: string | undefined;
  for (let page = 0; page < 3; page++) {
    const batch = await ctx.rpc.call<SignatureInfo[]>('getSignaturesForAddress', [candidate, { limit: 1000, commitment: 'confirmed', ...(before ? { before } : {}) }]);
    sigs.push(...batch);
    const oldest = batch[batch.length - 1]?.blockTime ?? null;
    if (batch.length < 1000 || (approxTime && oldest !== null && oldest < approxTime - 900)) break;
    before = batch[batch.length - 1].signature;
  }
  let pool = sigs.filter((s) => !s.err && s.blockTime);
  if (approxTime) {
    pool = pool
      .filter((s) => s.blockTime! <= approxTime + 900)
      .sort((a, b) => Math.abs(a.blockTime! - approxTime) - Math.abs(b.blockTime! - approxTime));
  } else {
    pool = pool.reverse();
  }
  const probe = pool.slice(0, 10);
  const txs = await ctx.rpc.getTransactions(probe, 3);
  const i = txs.findIndex((tx) => tx && createsMint(tx, mint));
  return { found: i >= 0 ? { signature: probe[i].signature, tx: txs[i]!, creatorSigs: sigs } : null, sigs };
}

/**
 * Buyers in the creation block, read from the block itself (account-level
 * detail carries pre/post token balances without instruction payloads).
 */
async function creationBlockBuyers(ctx: ScanContext, mint: string, slot: number, creationSig: string): Promise<ParsedTx[]> {
  try {
    const block = await ctx.rpc.call<{
      blockTime: number | null;
      transactions: { transaction: { signatures: string[]; accountKeys: { pubkey: string; signer: boolean }[] }; meta: ParsedTx['meta'] }[];
    }>('getBlock', [slot, { encoding: 'jsonParsed', transactionDetails: 'accounts', maxSupportedTransactionVersion: 1, rewards: false, commitment: 'confirmed' }]);
    return block.transactions
      .filter((t) => !t.meta?.err && t.transaction.signatures[0] !== creationSig && t.transaction.accountKeys.some((k) => k.pubkey === mint))
      .slice(0, 40)
      .map((t) => ({
        slot,
        blockTime: block.blockTime,
        meta: t.meta,
        transaction: { signatures: t.transaction.signatures, message: { accountKeys: t.transaction.accountKeys.map((k) => ({ ...k, writable: false })), instructions: [] } },
      }));
  } catch {
    return [];
  }
}

async function finish(
  ctx: ScanContext,
  input: LaunchInput,
  creationSignature: string,
  creationTx: ParsedTx,
  earlyTxs: (ParsedTx | null)[],
  mintSigs: SignatureInfo[] | null,
  creatorSigs?: SignatureInfo[],
): Promise<LaunchResult> {
  const deployer = feePayer(creationTx);
  const createdAt = creationTx.blockTime ?? null;
  const progs = programsInvoked(creationTx);
  const launchpadId = [...progs].find((p) => KNOWN_PROGRAMS[p]?.kind === 'launchpad');
  const launchpad = launchpadId ? KNOWN_PROGRAMS[launchpadId].name : createsMint(creationTx, input.mint) ? 'Direct mint (no launchpad)' : 'Unknown';
  const devInitial = deployer ? ownerDelta(creationTx, input.mint, deployer).post : 0;
  const devInitialPct = input.uiSupply > 0 ? (devInitial / input.uiSupply) * 100 : null;

  // Same-block buyers (bundle detection).
  const bundleWallets = new Map<string, number>();
  let bundleTx = 0;
  for (const tx of earlyTxs) {
    if (!tx) continue;
    const payer = feePayer(tx);
    if (!payer || payer === deployer) continue;
    const d = ownerDelta(tx, input.mint, payer);
    if (d.delta > 0) {
      bundleTx++;
      bundleWallets.set(payer, (bundleWallets.get(payer) ?? 0) + d.delta);
    }
  }
  const bundledUi = [...bundleWallets.values()].reduce((a, b) => a + b, 0);

  // Where the deployer's bag went: every transaction after creation that
  // reduced its balance, classified as a sale, transfer, lock or burn. An
  // outflow touches the deployer's token account and is signed by the
  // deployer, so the launch window is the intersection of both histories
  // (bots and spam reference a busy token account in thousands of
  // transactions the deployer never signed). The current balance catches
  // exits after the inspected window.
  const devSells: LaunchForensics['devSells'] = [];
  const devTransfers: LaunchForensics['devTransfers'] = [];
  const devLocks: LaunchForensics['devLocks'] = [];
  const devBurns: LaunchForensics['devBurns'] = [];
  let devCurrentPct: number | null = null;
  if (deployer) {
    const ata = associatedTokenAddress(deployer, input.mint, input.tokenProgram);
    const [ataHist, ownerHist, current] = await Promise.all([
      historySince(ctx, ata, createdAt),
      creatorSigs ? { sigs: creatorSigs, reached: true } : historySince(ctx, deployer, createdAt),
      ownerBalance(ctx, deployer, input.mint),
    ]);
    if (current !== null && input.uiSupply > 0) devCurrentPct = round((current / input.uiSupply) * 100);
    let history: SignatureInfo[];
    if (ataHist?.reached && ownerHist?.reached && ataHist.sigs.length) {
      const signedByOwner = new Set(ownerHist.sigs.map((s) => s.signature));
      const both = ataHist.sigs.filter((s) => signedByOwner.has(s.signature));
      history = both.length ? both : ataHist.sigs;
    } else if (ataHist?.reached && ataHist.sigs.length) {
      history = ataHist.sigs;
    } else {
      // Non-associated account, or a token account too busy to page back to
      // the launch: the deployer's own history, narrowed to the mint when known.
      const mintSet = mintSigs ? new Set(mintSigs.map((s) => s.signature)) : null;
      history = (ownerHist?.sigs ?? []).filter((s) => !mintSet || mintSet.has(s.signature));
    }
    const after = history
      .filter((s) => !s.err && s.signature !== creationSignature && (createdAt === null || (s.blockTime ?? 0) >= createdAt))
      .reverse()
      .slice(0, 12);
    const txs = after.length ? await ctx.rpc.getTransactions(after, 4) : [];
    txs.forEach((tx, i) => {
      if (!tx) return;
      const d = ownerDelta(tx, input.mint, deployer);
      if (d.delta >= 0) return;
      const base = {
        signature: after[i].signature,
        secondsAfterLaunch: tx.blockTime && createdAt ? tx.blockTime - createdAt : null,
        pctOfSupply: input.uiSupply > 0 ? (-d.delta / input.uiSupply) * 100 : 0,
      };
      const kind = outflowKind(tx, deployer, input.mint);
      if (kind === 'sale') devSells.push(base);
      else if (kind === 'transfer') devTransfers.push({ ...base, recipients: recipientsOf(tx, input.mint, deployer) });
      else if (kind === 'lock') devLocks.push({ ...base, locker: lockerName(tx) });
      else devBurns.push(base);
    });
  }

  const launch: LaunchForensics = {
    reached: true,
    signaturesScanned: mintSigs?.length ?? 0,
    creationSignature,
    createdAt,
    slot: creationTx.slot,
    launchpad,
    deployer,
    devInitialPct: devInitialPct === null ? null : round(devInitialPct),
    bundled: {
      wallets: [...bundleWallets.keys()],
      pctOfSupply: round(input.uiSupply > 0 ? (bundledUi / input.uiSupply) * 100 : 0),
      txCount: bundleTx,
    },
    devSells,
    devTransfers,
    devLocks,
    devBurns,
    devCurrentPct,
  };
  return { launch, findings: launchFindings(launch, ctx.now()) };
}

const TRADING_VENUES = new Set(['launchpad', 'amm', 'aggregator', 'orderbook']);
/** More SOL back than closing a few token accounts refunds in rent. */
const SALE_MIN_LAMPORTS = 10_000_000;

export type Outflow = 'sale' | 'transfer' | 'lock' | 'burn';

function parsedOf(i: ParsedInstruction): { type: string; info: Record<string, unknown> } | null {
  return typeof i.parsed === 'object' && i.parsed ? { type: i.parsed.type ?? '', info: i.parsed.info ?? {} } : null;
}

/**
 * Why a holder's balance of `mint` dropped in this transaction. A sale runs a
 * trading venue (directly or through a router's CPI) or returns SOL or
 * wrapped SOL; locks and burns take tokens off the market; anything else is
 * a transfer to other wallets (an airdrop, or supply moved to alt wallets).
 */
export function outflowKind(tx: ParsedTx, owner: string, mint: string): Outflow {
  const kinds = new Set([...programsInvoked(tx)].map((p) => KNOWN_PROGRAMS[p]?.kind));
  if (kinds.has('locker')) return 'lock';
  if ([...TRADING_VENUES].some((k) => kinds.has(k as never))) return 'sale';
  if (allInstructions(tx).some((i) => /^burn/.test(parsedOf(i)?.type ?? '') && parsedOf(i)?.info.mint === mint)) return 'burn';
  if (ownerDelta(tx, WSOL_MINT, owner).delta > 0) return 'sale';
  const i = tx.transaction.message.accountKeys.findIndex((k) => k.pubkey === owner);
  if (i < 0 || !tx.meta) return 'transfer';
  const solBack = tx.meta.postBalances[i] - tx.meta.preBalances[i] + (i === 0 ? tx.meta.fee : 0);
  return solBack > SALE_MIN_LAMPORTS ? 'sale' : 'transfer';
}

/**
 * Signature history of an address back to `since` (unix seconds), newest
 * first. `reached` is false when three pages were not enough; null on RPC failure.
 */
async function historySince(ctx: ScanContext, address: string, since: number | null): Promise<{ sigs: SignatureInfo[]; reached: boolean } | null> {
  try {
    const sigs: SignatureInfo[] = [];
    let before: string | undefined;
    for (let page = 0; page < 3; page++) {
      const batch = await ctx.rpc.call<SignatureInfo[]>('getSignaturesForAddress', [address, { limit: 1000, commitment: 'confirmed', ...(before ? { before } : {}) }]);
      sigs.push(...batch);
      const oldest = batch[batch.length - 1];
      if (batch.length < 1000 || (since !== null && (oldest.blockTime ?? Infinity) <= since)) return { sigs, reached: true };
      before = oldest.signature;
    }
    return { sigs, reached: false };
  } catch {
    return null;
  }
}

function lockerName(tx: ParsedTx): string {
  for (const p of programsInvoked(tx)) if (KNOWN_PROGRAMS[p]?.kind === 'locker') return KNOWN_PROGRAMS[p].name;
  return 'a locker';
}

/** Wallets (other than the sender) whose balance of the mint grew in this transaction. */
function recipientsOf(tx: ParsedTx, mint: string, sender: string): number {
  const owners = new Set(
    (tx.meta?.postTokenBalances ?? []).filter((b) => b.mint === mint && b.owner && b.owner !== sender).map((b) => b.owner!),
  );
  return [...owners].filter((o) => ownerDelta(tx, mint, o).delta > 0).length;
}

async function ownerBalance(ctx: ScanContext, owner: string, mint: string): Promise<number | null> {
  try {
    const res = await ctx.rpc.call<{
      value: { account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null; uiAmountString?: string } } } } } }[];
    }>('getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    return res.value.reduce((s, a) => {
      const t = a.account.data.parsed.info.tokenAmount;
      return s + (t.uiAmount ?? Number(t.uiAmountString ?? 0));
    }, 0);
  } catch {
    return null;
  }
}

function emptyLaunch(scanned: number): LaunchForensics {
  return {
    reached: false,
    signaturesScanned: scanned,
    creationSignature: null,
    createdAt: null,
    slot: null,
    launchpad: null,
    deployer: null,
    devInitialPct: null,
    bundled: { wallets: [], pctOfSupply: 0, txCount: 0 },
    devSells: [],
    devTransfers: [],
    devLocks: [],
    devBurns: [],
    devCurrentPct: null,
  };
}

export function launchFindings(l: LaunchForensics, now: number): Finding[] {
  const findings: Finding[] = [];
  const total = (xs: { pctOfSupply: number }[]) => xs.reduce((s, x) => s + x.pctOfSupply, 0);
  const at = (xs: { secondsAfterLaunch: number | null }[]) => {
    const first = xs.find((x) => x.secondsAfterLaunch !== null);
    return first?.secondsAfterLaunch != null ? ` ${humanSeconds(first.secondsAfterLaunch)} after launch` : '';
  };
  const txEvidence = (label: string, xs: { signature: string }[]) =>
    xs.slice(0, 3).map((x) => ({ label, value: x.signature, href: `https://solscan.io/tx/${x.signature}` }));
  const bag = l.devInitialPct && l.devInitialPct > 0 ? l.devInitialPct : null;
  // Share of the launch bag when it is known, share of supply otherwise.
  const share = (pct: number) => (bag ? `${pctText(Math.min(1, pct / bag) * 100)} of their bag` : `${pctText(pct)} of supply`);

  const sold = total(l.devSells);
  const moved = total(l.devTransfers);
  const locked = total(l.devLocks);
  const burned = total(l.devBurns);
  const recipients = l.devTransfers.reduce((s, x) => s + x.recipients, 0);

  if (l.devSells.length) {
    const soldShare = bag ? sold / bag : null;
    const firstSell = l.devSells.find((s) => s.secondsAfterLaunch !== null);
    const fast = firstSell?.secondsAfterLaunch != null && firstSell.secondsAfterLaunch <= 600;
    // A sliver of the bag (often just the launch cost) is not a dump.
    const minor = soldShare !== null ? soldShare < 0.1 : sold < 0.5;
    const critical = fast && !minor && (soldShare === null || soldShare >= 0.5);
    findings.push({
      id: 'DEV_SOLD',
      severity: critical ? 'critical' : minor ? 'medium' : 'high',
      category: 'launch',
      title: `Deployer ${critical ? 'dumped' : 'sold'} ${share(sold)}${at(l.devSells)}`,
      detail: 'Dev-buy-and-dump is the default rug on launchpads. In our field sample, 13 of 13 dead launches had the creator exit, median 7 seconds after launch.',
      weight: critical ? 55 : minor ? 10 : 25,
      evidence: txEvidence('Sell tx', l.devSells),
    });
  }

  // Fake holders: rent paid to drop a few tokens into many fresh wallets.
  if (recipients >= 10 && moved / recipients < 0.01) {
    findings.push({
      id: 'HOLDER_SPRAY',
      severity: 'high',
      category: 'launch',
      title: `Deployer sprayed dust into at least ${plural(recipients, 'wallet')}${at(l.devTransfers)}`,
      detail: 'The deployer paid account rent to drop a few tokens into fresh wallets. That inflates the holder count terminals display: manufactured social proof, not demand.',
      weight: 20,
      evidence: txEvidence('Transfer tx', l.devTransfers),
    });
  } else if (moved >= 1) {
    findings.push({
      id: 'DEV_DISTRIBUTED',
      severity: moved >= 5 ? 'high' : 'medium',
      category: 'launch',
      title: `Deployer moved ${pctText(moved)} of supply to ${plural(recipients, 'other wallet')}${at(l.devTransfers)}`,
      detail: 'Supply moved off the deployer wallet hides the dev bag from holder checks. Those wallets can sell without ever showing up as the deployer.',
      weight: moved >= 5 ? 20 : 10,
      evidence: txEvidence('Transfer tx', l.devTransfers),
    });
  }

  if (l.devLocks.length) {
    findings.push({
      id: 'DEV_LOCKED',
      severity: 'info',
      category: 'launch',
      title: `Deployer locked ${share(locked)} in ${l.devLocks[0].locker}${at(l.devLocks)}`,
      detail: 'Locked tokens cannot be sold until the lock releases. RugHawk does not read the unlock schedule yet: check it on the locker before counting on it.',
      weight: 0,
      evidence: txEvidence('Lock tx', l.devLocks),
    });
  }
  if (l.devBurns.length) {
    findings.push({
      id: 'DEV_BURNED',
      severity: 'good',
      category: 'launch',
      title: `Deployer burned ${share(burned)}${at(l.devBurns)}`,
      detail: 'Burned tokens are destroyed: that part of the dev bag can never be sold.',
      weight: 0,
      evidence: txEvidence('Burn tx', l.devBurns),
    });
  }

  // Bag that left the wallet without passing through the inspected
  // transactions: the route is unknown, so it is neither clean nor a proven dump.
  const unexplained = bag && l.devCurrentPct !== null ? Math.max(0, bag - l.devCurrentPct - sold - moved - locked - burned) : 0;
  if (bag && unexplained >= bag * 0.5) {
    findings.push({
      id: 'DEV_EXITED',
      severity: 'medium',
      category: 'launch',
      title: `Deployer wallet no longer holds ${pctText((unexplained / bag) * 100)} of its launch bag`,
      detail: 'The tokens left after the transactions RugHawk inspected, so the route (sale, transfer, lock or burn) is unverified. Trace the deployer wallet before trusting the launch.',
      weight: 12,
    });
  } else if (!l.devSells.length && l.deployer && (!bag || unexplained < bag * 0.1)) {
    findings.push({
      id: 'DEV_NOT_SOLD',
      severity: 'good',
      category: 'launch',
      title: 'No deployer sells found in the launch window',
      detail: 'Measured on trending launches: creators who never sold were the only ones still alive five hours later.',
      weight: 0,
    });
  }

  const n = l.bundled.wallets.length;
  if (n >= 3 || l.bundled.pctOfSupply >= 10) {
    const crit = l.bundled.pctOfSupply >= 10;
    findings.push({
      id: 'BUNDLED_LAUNCH',
      severity: crit ? 'critical' : 'high',
      category: 'launch',
      title: `${plural(n, 'wallet')} bought in the launch block (${l.bundled.pctOfSupply.toFixed(2)}% of supply)`,
      detail: 'Buys that land in the same block as the token creation are bundled with the deployer or are snipers with insider timing. They hold supply bought before the public could.',
      weight: crit ? 45 : 25,
      evidence: l.bundled.wallets.slice(0, 5).map((w) => ({ label: 'Bundled wallet', value: w, href: `/wallet/${w}` })),
    });
  } else if (n > 0) {
    findings.push({
      id: 'LAUNCH_SNIPERS',
      severity: 'medium',
      category: 'launch',
      title: `${plural(n, 'wallet')} sniped the launch block`,
      detail: 'Same-block buyers had the transaction before the public saw the token.',
      weight: 8,
      evidence: l.bundled.wallets.map((w) => ({ label: 'Sniper', value: w, href: `/wallet/${w}` })),
    });
  }

  if (l.devInitialPct !== null && l.devInitialPct >= 10) {
    findings.push({
      id: 'DEV_BIG_BUY',
      severity: l.devInitialPct >= 20 ? 'high' : 'medium',
      category: 'launch',
      title: `Deployer bought ${l.devInitialPct.toFixed(1)}% of supply at creation`,
      detail: 'A large dev buy inside the creation transaction is inventory to dump on the first buyers. Typical dev-dump launches take 5 to 15%.',
      weight: l.devInitialPct >= 20 ? 20 : 10,
    });
  }

  if (l.createdAt) {
    const ageH = (now / 1000 - l.createdAt) / 3600;
    findings.push({
      id: 'LAUNCH_INFO',
      severity: 'info',
      category: 'launch',
      title: `Launched via ${l.launchpad} ${ageH < 48 ? `${Math.max(0, Math.round(ageH))}h` : `${Math.round(ageH / 24)}d`} ago`,
      detail: `Creation transaction signed by ${l.deployer ?? 'unknown'}.`,
      weight: 0,
      evidence: l.creationSignature ? [{ label: 'Creation tx', value: l.creationSignature, href: `https://solscan.io/tx/${l.creationSignature}` }] : undefined,
    });
  }
  return findings;
}

/** Token balance change for one owner within a transaction (UI units). */
export function ownerDelta(tx: ParsedTx, mint: string, owner: string): { pre: number; post: number; delta: number } {
  const sum = (bals: TokenBalance[] | undefined) =>
    (bals ?? [])
      .filter((b) => b.mint === mint && b.owner === owner)
      .reduce((s, b) => s + (b.uiTokenAmount.uiAmount ?? Number(b.uiTokenAmount.uiAmountString ?? 0)), 0);
  const pre = sum(tx.meta?.preTokenBalances);
  const post = sum(tx.meta?.postTokenBalances);
  return { pre, post, delta: post - pre };
}

export function humanSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
