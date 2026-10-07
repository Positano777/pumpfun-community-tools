import type { Finding, ProgramInfo, WalletReport } from './types';
import type { ScanContext } from './context';
import { cached, fetchJson, guarded } from './context';
import { addressHistory, looksLikeExchange, traceFunding } from './funding';
import { loadShield } from './shield';
import { scoreFindings, sortFindings } from './score';
import { allInstructions } from '../rpc';
import { plural } from '../format';
import { BPF_UPGRADEABLE_LOADER, KNOWN_PROGRAMS, SYSTEM_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, programLabel } from '../solana/known';
import { base64ToBytes, bytesToAddress, isAddress, isPda, shortAddress } from '../solana/address';

const STAKE_PROGRAM = 'Stake11111111111111111111111111111111111111';
const SAMPLE = 25;

interface RawAccount {
  owner: string;
  executable: boolean;
  lamports: number;
  space?: number;
  data: [string, string];
}

export async function scanWallet(ctx: ScanContext, address: string): Promise<WalletReport> {
  if (!isAddress(address)) throw new Error('Invalid Solana address');
  const started = Date.now();
  const callsBefore = ctx.rpc.calls;
  const partial: string[] = [];
  const findings: Finding[] = [];

  const res = await ctx.rpc.call<{ value: RawAccount | null }>('getAccountInfo', [address, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }]);
  const acct = res.value;
  let tokenKind: string | null = null;
  if (acct && (acct.owner === TOKEN_PROGRAM || acct.owner === TOKEN_2022_PROGRAM)) {
    const parsed = await ctx.rpc.call<{ value: { data: { parsed?: { type?: string } } } | null }>('getAccountInfo', [address, { encoding: 'jsonParsed' }]);
    tokenKind = parsed.value?.data?.parsed?.type ?? null;
  }
  const accountType: WalletReport['accountType'] = !acct
    ? 'empty'
    : acct.executable
      ? 'program'
      : tokenKind
        ? tokenKind === 'mint' ? 'mint' : 'token-account'
        : acct.owner === STAKE_PROGRAM
          ? 'stake'
          : acct.owner === SYSTEM_PROGRAM
            ? isPda(address) ? 'pda' : 'wallet'
            : isPda(address) ? 'pda' : 'unknown';
  const label = programLabel(address);

  let program: ProgramInfo | null = null;
  if (accountType === 'program') {
    program = await guarded(partial, 'program', () => inspectProgram(ctx, address, acct!), null);
    if (program) findings.push(...programFindings(program));
  }

  const history = await guarded(partial, 'history', () => addressHistory(ctx, address, 2), null);
  const sigs = history?.sigs ?? [];
  const firstSeen = history?.reachedStart ? sigs[sigs.length - 1]?.blockTime ?? null : null;
  const lastSeen = sigs[0]?.blockTime ?? null;
  const failed = sigs.filter((s) => s.err).length;
  const spanDays = firstSeen && lastSeen ? Math.max((lastSeen - firstSeen) / 86_400, 1 / 24) : null;
  const activity: WalletReport['activity'] = {
    txCount: sigs.length,
    capped: !(history?.reachedStart ?? true),
    firstSeen,
    lastSeen,
    failedRatio: sigs.length ? Math.round((failed / sigs.length) * 100) / 100 : 0,
    perDay: spanDays ? Math.round((sigs.length / spanDays) * 10) / 10 : null,
  };

  const isWalletLike = accountType === 'wallet' || accountType === 'pda' || accountType === 'empty';
  const [funding, shield, sample] = await Promise.all([
    isWalletLike && history ? guarded(partial, 'funding', () => traceFunding(ctx, address, 3, history), []) : Promise.resolve([]),
    accountType === 'wallet' ? guarded(partial, 'holdings', () => loadShield(ctx, address), null) : Promise.resolve(null),
    guarded(partial, 'transactions', () => ctx.rpc.getTransactions(sigs.filter((s) => !s.err).slice(0, SAMPLE).map((s) => s.signature), 4), []),
  ]);

  // Counterparties from SOL transfers and token-transfer authorities.
  const cp = new Map<string, { count: number; inboundTiny: number; outbound: number; sig: string }>();
  const created: WalletReport['tokensCreated'] = [];
  sample.forEach((tx) => {
    if (!tx) return;
    const sig = tx.transaction.signatures[0];
    for (const ix of allInstructions(tx)) {
      if (typeof ix.parsed !== 'object' || !ix.parsed?.info) continue;
      const info = ix.parsed.info as Record<string, unknown>;
      const t = ix.parsed.type;
      if (t === 'transfer' && typeof info.lamports === 'number') {
        const src = String(info.source);
        const dst = String(info.destination);
        if (dst === address && src !== address) bump(cp, src, sig, info.lamports <= 1_000_000 ? 'tiny' : 'in');
        if (src === address && dst !== address) bump(cp, dst, sig, 'out');
      }
      if ((ix.programId === TOKEN_PROGRAM || ix.programId === TOKEN_2022_PROGRAM) && /^initializeMint/.test(t ?? '') && typeof info.mint === 'string') {
        if (!created.some((c) => c.mint === info.mint)) created.push({ mint: info.mint as string, signature: sig, time: tx.blockTime ?? null });
      }
    }
  });
  const counterparties = [...cp.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 12)
    .map(([a, v]) => ({ address: a, count: v.count, label: programLabel(a) }));

  // Address poisoning: a lookalike (same first 4 and last 4 characters) of a
  // real counterparty that pushed dust into this wallet's history, hoping the
  // owner copies it from "recent activity" next time.
  const poisoning: WalletReport['poisoning'] = [];
  const entries = [...cp.entries()];
  for (let i = 0; i < entries.length; i++) {
    for (let j = 0; j < entries.length; j++) {
      const [a, va] = entries[i];
      const [b, vb] = entries[j];
      // Wallet UIs show the first and last 4 characters; vanity grinders match
      // 4+3 or 3+4 cheaply. The dust-in/never-paid pattern below keeps this tight.
      const lookalike = a !== b && ((a.slice(0, 4) === b.slice(0, 4) && a.slice(-3) === b.slice(-3)) || (a.slice(0, 3) === b.slice(0, 3) && a.slice(-4) === b.slice(-4)));
      if (!lookalike) continue;
      if (va.inboundTiny > 0 && va.outbound === 0 && vb.outbound > 0 && !poisoning.some((p) => p.lookalike === a)) {
        poisoning.push({ lookalike: a, mimics: b, signature: va.sig });
      }
    }
  }

  // ---- Findings ---------------------------------------------------------
  if (label && accountType !== 'program') {
    findings.push({ id: 'KNOWN_ACCOUNT', severity: 'info', category: 'intel', title: `Known account: ${label}`, detail: 'Matched against RugHawk\'s verified program and account list.', weight: 0 });
  }
  if (accountType === 'mint') {
    findings.push({ id: 'IS_MINT', severity: 'info', category: 'intel', title: 'This is a token mint', detail: 'Run a token scan for the full rug-risk report.', weight: 0 });
  }
  if (isWalletLike && history && looksLikeExchange(history)) {
    findings.push({
      id: 'EXCHANGE_LIKE',
      severity: 'info',
      category: 'activity',
      title: 'High-volume hot wallet',
      detail: 'Thousands of transactions or a large SOL float: behaves like an exchange, market maker or bot.',
      weight: 0,
    });
  } else if (isWalletLike && firstSeen) {
    const ageDays = (ctx.now() / 1000 - firstSeen) / 86_400;
    if (ageDays < 7) {
      findings.push({
        id: 'FRESH_WALLET',
        severity: ageDays < 1 ? 'high' : 'medium',
        category: 'activity',
        title: `Wallet is ${ageDays < 1 ? plural(Math.max(1, Math.round(ageDays * 24)), 'hour') : plural(Math.round(ageDays), 'day')} old`,
        detail: 'Fresh wallets are the default tool of drainers, launch operators and OTC scammers: no history, no reputation at stake.',
        weight: ageDays < 1 ? 18 : 10,
      });
    }
  }
  if (isWalletLike && activity.txCount > 50 && activity.failedRatio > 0.5) {
    findings.push({
      id: 'BOT_PATTERN',
      severity: 'low',
      category: 'activity',
      title: `${Math.round(activity.failedRatio * 100)}% of transactions fail`,
      detail: 'High failure rates are typical of sniper and spam bots, not people.',
      weight: 4,
    });
  }
  if (created.length >= 2) {
    findings.push({
      id: 'SERIAL_LAUNCHER',
      severity: created.length >= 6 ? 'critical' : 'high',
      category: 'deployer',
      title: `Minted ${created.length} tokens in its last ${plural(sample.length, 'transaction')}`,
      detail: 'This wallet is a token factory. Serial launchers spray tokens and dump whichever one gets bids.',
      weight: created.length >= 6 ? 45 : 25,
      evidence: created.slice(0, 5).map((c) => ({ label: 'Mint', value: c.mint, href: `/token/${c.mint}` })),
    });
  }
  if (poisoning.length) {
    findings.push({
      id: 'ADDRESS_POISONING',
      severity: 'high',
      category: 'exposure',
      title: `${poisoning.length} lookalike address${poisoning.length > 1 ? 'es' : ''} in recent history`,
      detail: 'An attacker sent dust from an address that copies the first and last characters of one you transact with. Never copy addresses from activity history.',
      weight: 25,
      evidence: poisoning.slice(0, 3).map((p) => ({ label: `${shortAddress(p.lookalike, 5)} mimics`, value: p.mimics })),
    });
  }
  if (shield) {
    if (shield.delegated.length) {
      findings.push({
        id: 'ACTIVE_APPROVALS',
        severity: 'high',
        category: 'exposure',
        title: `${shield.delegated.length} live token approval${shield.delegated.length > 1 ? 's' : ''}`,
        detail: 'A delegate can move these tokens without another signature. Drainers harvest approvals signed on phishing sites. Revoke them in Shield.',
        weight: 25,
        evidence: shield.delegated.slice(0, 4).map((d) => ({ label: `Delegate on ${shortAddress(d.mint)}`, value: d.delegate ?? '' })),
      });
    }
    if (shield.permanentDelegateExposure.length) {
      findings.push({
        id: 'PERMANENT_DELEGATE_EXPOSURE',
        severity: 'medium',
        category: 'exposure',
        title: `Holds ${shield.permanentDelegateExposure.length} token${shield.permanentDelegateExposure.length > 1 ? 's' : ''} its issuer can seize`,
        detail: 'These mints have a permanent delegate that can move the balance at any time.',
        weight: 10,
        evidence: shield.permanentDelegateExposure.slice(0, 4).map((d) => ({ label: 'Mint', value: d.mint, href: `/token/${d.mint}` })),
      });
    }
    if (shield.frozen.length) {
      findings.push({ id: 'FROZEN_ACCOUNTS', severity: 'low', category: 'exposure', title: `${shield.frozen.length} frozen token account${shield.frozen.length > 1 ? 's' : ''}`, detail: 'An issuer froze these balances; they cannot be sold.', weight: 4 });
    }
    if (shield.closable.length) {
      findings.push({
        id: 'RECLAIMABLE_RENT',
        severity: 'info',
        category: 'exposure',
        title: `${shield.closable.length} empty token accounts lock ${shield.reclaimableSol.toFixed(4)} SOL`,
        detail: 'Closing empty accounts returns their rent deposit to the owner.',
        weight: 0,
      });
    }
  }
  const funder = funding[1];
  if (funder?.kind === 'exchange-like') {
    findings.push({ id: 'FUNDED_BY_EXCHANGE', severity: 'info', category: 'funding', title: 'First SOL came from an exchange-like hot wallet', detail: 'Neutral on its own; it ends the on-chain trail.', weight: 0 });
  }

  const sorted = sortFindings(findings);
  return {
    kind: 'wallet',
    version: 1,
    address,
    scannedAt: ctx.now(),
    durationMs: Date.now() - started,
    rpcCalls: ctx.rpc.calls - callsBefore,
    accountType,
    owner: acct?.owner ?? null,
    label: label ?? (acct && !acct.executable && acct.owner !== SYSTEM_PROGRAM ? (KNOWN_PROGRAMS[acct.owner] ? `${KNOWN_PROGRAMS[acct.owner].name} account` : null) : null),
    solBalance: (acct?.lamports ?? 0) / 1e9,
    activity,
    funding,
    holdings: shield
      ? {
          tokenAccounts: shield.accounts.length,
          nonZero: shield.accounts.filter((a) => a.uiAmount > 0).length,
          delegated: shield.delegated.map((d) => ({ tokenAccount: d.address, mint: d.mint, delegate: d.delegate!, delegatedUi: d.delegatedUi, balanceUi: d.uiAmount, programId: d.programId })),
          frozen: shield.frozen.length,
          permanentDelegateTokens: shield.permanentDelegateExposure.map((a) => ({ mint: a.mint, delegate: a.permanentDelegate! })),
          empty: shield.closable.length,
          reclaimableSol: shield.reclaimableSol,
        }
      : null,
    counterparties,
    poisoning,
    tokensCreated: created,
    program,
    findings: sorted,
    risk: scoreFindings(sorted),
    ai: null,
    partial,
  };
}

function bump(map: Map<string, { count: number; inboundTiny: number; outbound: number; sig: string }>, addr: string, sig: string, kind: 'in' | 'tiny' | 'out') {
  const v = map.get(addr) ?? { count: 0, inboundTiny: 0, outbound: 0, sig };
  v.count++;
  if (kind === 'tiny') {
    v.inboundTiny++;
    v.sig = sig;
  }
  if (kind === 'out') v.outbound++;
  map.set(addr, v);
}

async function inspectProgram(ctx: ScanContext, programId: string, acct: RawAccount): Promise<ProgramInfo> {
  const info: ProgramInfo = {
    executable: true,
    loader: acct.owner,
    upgradeable: false,
    upgradeAuthority: null,
    authorityIsPda: null,
    lastDeploySlot: null,
    verified: null,
    verifiedRepo: null,
    label: programLabel(programId),
  };
  if (acct.owner === BPF_UPGRADEABLE_LOADER) {
    const prog = await ctx.rpc.call<{ value: RawAccount | null }>('getAccountInfo', [programId, { encoding: 'base64', dataSlice: { offset: 0, length: 36 } }]);
    const bytes = prog.value ? base64ToBytes(prog.value.data[0]) : null;
    if (bytes && bytes.length >= 36) {
      const programData = bytesToAddress(bytes.slice(4, 36));
      const pd = await ctx.rpc.call<{ value: RawAccount | null }>('getAccountInfo', [programData, { encoding: 'base64', dataSlice: { offset: 0, length: 45 } }]);
      const pdb = pd.value ? base64ToBytes(pd.value.data[0]) : null;
      if (pdb && pdb.length >= 13) {
        const view = new DataView(pdb.buffer, pdb.byteOffset, pdb.byteLength);
        info.lastDeploySlot = Number(view.getBigUint64(4, true));
        if (pdb[12] === 1 && pdb.length >= 45) {
          info.upgradeable = true;
          info.upgradeAuthority = bytesToAddress(pdb.slice(13, 45));
          info.authorityIsPda = isPda(info.upgradeAuthority);
        }
      }
    }
  }
  const osec = await cached(ctx, `osec:${programId}`, 3600, () =>
    fetchJson<{ is_verified?: boolean; repo_url?: string }>(ctx, `https://verify.osec.io/status/${programId}`, 5000, 50_000).catch(() => null),
  );
  if (osec) {
    info.verified = Boolean(osec.is_verified);
    info.verifiedRepo = osec.repo_url || null;
  }
  return info;
}

function programFindings(p: ProgramInfo): Finding[] {
  const out: Finding[] = [];
  if (p.label) out.push({ id: 'KNOWN_PROGRAM', severity: 'good', category: 'program', title: `Known program: ${p.label}`, detail: 'On RugHawk\'s verified program list.', weight: 0 });
  if (p.upgradeable && p.upgradeAuthority) {
    const pda = p.authorityIsPda;
    out.push({
      id: 'PROGRAM_UPGRADEABLE',
      severity: pda ? 'low' : 'medium',
      category: 'program',
      title: pda ? 'Upgradeable by a program-controlled authority' : 'Upgradeable by a single key',
      detail: pda
        ? 'The code can change, but the authority is a PDA (typically a multisig or DAO), not one person.'
        : 'One private key can replace this program\'s code at any time, including logic that holds your funds.',
      weight: pda ? 4 : 15,
      evidence: [{ label: 'Upgrade authority', value: p.upgradeAuthority, href: `/wallet/${p.upgradeAuthority}` }],
    });
  } else {
    out.push({ id: 'PROGRAM_IMMUTABLE', severity: 'good', category: 'program', title: 'Program is immutable', detail: 'No upgrade authority: the deployed code can never change.', weight: 0 });
  }
  if (p.verified === true) {
    out.push({
      id: 'PROGRAM_VERIFIED',
      severity: 'good',
      category: 'program',
      title: 'Verified build',
      detail: 'The on-chain bytecode matches a public source repository (OtterSec verify registry).',
      weight: 0,
      evidence: p.verifiedRepo ? [{ label: 'Source', value: p.verifiedRepo, href: p.verifiedRepo }] : undefined,
    });
  } else if (p.verified === false && !p.label) {
    out.push({
      id: 'PROGRAM_UNVERIFIED',
      severity: 'low',
      category: 'program',
      title: 'No verified build',
      detail: 'Nobody has proven which source code this bytecode came from.',
      weight: 6,
    });
  }
  return out;
}
