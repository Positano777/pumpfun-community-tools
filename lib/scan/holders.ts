import { PublicKey } from '@solana/web3.js';
import type { Finding, Holder, HolderLabel, HolderStats } from './types';
import type { ScanContext } from './context';
import { INCINERATOR, KNOWN_ACCOUNTS, KNOWN_PROGRAMS } from '../solana/known';
import { isPda } from '../solana/address';

let derivedAuthorities: Record<string, string> | null = null;

/** Pool authorities that are PDAs with no account of their own, derived from their seeds. */
function poolAuthorities(): Record<string, string> {
  if (derivedAuthorities) return derivedAuthorities;
  const out: Record<string, string> = {};
  try {
    const [cpmm] = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode('vault_and_lp_mint_auth_seed')],
      new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C'),
    );
    out[cpmm.toBase58()] = 'Raydium CPMM pool vault';
  } catch {
    // derivation never fails for valid seeds; keep the map usable regardless
  }
  derivedAuthorities = out;
  return out;
}

interface LargestAccount {
  address: string;
  amount: string;
  uiAmount: number | null;
  uiAmountString?: string;
}

export async function analyzeHolders(
  ctx: ScanContext,
  mint: string,
  uiSupply: number,
  deployer: string | null,
): Promise<{ stats: HolderStats; findings: Finding[] }> {
  const largest = await ctx.rpc.call<{ value: LargestAccount[] }>('getTokenLargestAccounts', [mint, { commitment: 'confirmed' }]);
  const accounts = largest.value.slice(0, 20);
  const tokenAccts = await ctx.rpc.getMultipleAccounts<{ data: { parsed?: { info?: { owner?: string } } } }>(
    accounts.map((a) => a.address),
    { encoding: 'jsonParsed' },
  );
  const owners = tokenAccts.map((t) => t?.data?.parsed?.info?.owner ?? null);
  const uniqueOwners = [...new Set(owners.filter((o): o is string => Boolean(o)))];
  const ownerAccts = uniqueOwners.length
    ? await ctx.rpc.getMultipleAccounts<{ owner: string; executable: boolean; lamports: number }>(uniqueOwners, {
        encoding: 'base64',
        dataSlice: { offset: 0, length: 0 },
      })
    : [];
  const ownerProgram = new Map<string, string | null>();
  const ownerLamports = new Map<string, number>();
  uniqueOwners.forEach((o, i) => {
    ownerProgram.set(o, ownerAccts[i]?.owner ?? null);
    ownerLamports.set(o, ownerAccts[i]?.lamports ?? 0);
  });
  const authorities = poolAuthorities();

  const top: Holder[] = accounts.map((a, i) => {
    const owner = owners[i];
    const ui = a.uiAmount ?? Number(a.uiAmountString ?? 0);
    const pct = uiSupply > 0 ? (ui / uiSupply) * 100 : 0;
    const { label, detail } = classify(owner, ownerProgram.get(owner ?? '') ?? null, deployer, authorities, ownerLamports.get(owner ?? '') ?? 0);
    return { tokenAccount: a.address, owner, uiAmount: ui, pct, label, labelDetail: detail };
  });

  const isWallet = (h: Holder) => h.label === 'wallet' || h.label === 'deployer' || h.label === 'unknown';
  const wallets = top.filter(isWallet);
  const sum = (hs: Holder[]) => hs.reduce((s, h) => s + h.pct, 0);
  const stats: HolderStats = {
    top,
    top10WalletPct: round(sum(wallets.slice(0, 10))),
    largestWalletPct: round(wallets[0]?.pct ?? 0),
    poolPct: round(sum(top.filter((h) => h.label === 'pool' || h.label === 'curve'))),
    burnedPct: round(sum(top.filter((h) => h.label === 'burn'))),
    lockedPct: round(sum(top.filter((h) => h.label === 'locker'))),
  };

  const findings: Finding[] = [];
  const t10 = stats.top10WalletPct;
  if (t10 >= 50) {
    findings.push({
      id: 'TOP10_CONCENTRATION',
      severity: 'critical',
      category: 'holders',
      title: `Top 10 wallets hold ${t10.toFixed(1)}% of supply`,
      detail: 'Pools and burns excluded. A handful of wallets can drain the pool in one block; this is how most coordinated dumps look before they happen.',
      weight: 45,
    });
  } else if (t10 >= 30) {
    findings.push({
      id: 'TOP10_CONCENTRATION',
      severity: 'high',
      category: 'holders',
      title: `Top 10 wallets hold ${t10.toFixed(1)}% of supply`,
      detail: 'Pools and burns excluded. Concentration this high lets insiders set the price.',
      weight: 22,
    });
  } else if (t10 >= 20) {
    findings.push({
      id: 'TOP10_CONCENTRATION',
      severity: 'medium',
      category: 'holders',
      title: `Top 10 wallets hold ${t10.toFixed(1)}% of supply`,
      detail: 'Pools and burns excluded. Moderate concentration: watch the largest holders.',
      weight: 10,
    });
  } else if (wallets.length > 0) {
    findings.push({
      id: 'HOLDERS_DISTRIBUTED',
      severity: 'good',
      category: 'holders',
      title: `Top 10 wallets hold ${t10.toFixed(1)}% of supply`,
      detail: 'Supply is reasonably distributed outside pools.',
      weight: 0,
    });
  }

  const whale = wallets[0];
  if (whale && whale.pct >= 15) {
    findings.push({
      id: 'SINGLE_WHALE',
      severity: whale.pct >= 30 ? 'critical' : 'high',
      category: 'holders',
      title: `One wallet holds ${whale.pct.toFixed(1)}% of supply`,
      detail: whale.label === 'deployer' ? 'The deployer itself is the largest holder.' : 'A single wallet can crash the price on its own.',
      weight: whale.pct >= 30 ? 45 : 20,
      evidence: [{ label: 'Wallet', value: whale.owner ?? whale.tokenAccount }],
    });
  }

  const dev = top.find((h) => h.label === 'deployer');
  if (dev && dev.pct >= 5 && dev !== whale) {
    findings.push({
      id: 'DEPLOYER_HOLDS',
      severity: dev.pct >= 15 ? 'high' : 'medium',
      category: 'holders',
      title: `Deployer still holds ${dev.pct.toFixed(1)}% of supply`,
      detail: 'Dev holdings are an open exit. Measured on trending launches: creators who never sold were the only ones still alive at T+5h.',
      weight: dev.pct >= 15 ? 20 : 8,
    });
  }

  if (stats.burnedPct >= 1) {
    findings.push({
      id: 'SUPPLY_BURNED',
      severity: 'info',
      category: 'holders',
      title: `${stats.burnedPct.toFixed(1)}% of supply sits in the incinerator`,
      detail: 'Tokens sent to the burn address are permanently out of circulation.',
      weight: 0,
    });
  }

  return { stats, findings };
}

function classify(
  owner: string | null,
  ownerProgram: string | null,
  deployer: string | null,
  authorities: Record<string, string>,
  lamports: number,
): { label: HolderLabel; detail?: string } {
  if (!owner) return { label: 'unknown' };
  if (owner === INCINERATOR) return { label: 'burn', detail: 'Burn address' };
  if (deployer && owner === deployer) return { label: 'deployer', detail: 'Token deployer' };
  if (KNOWN_ACCOUNTS[owner]) return { label: 'pool', detail: KNOWN_ACCOUNTS[owner] };
  if (authorities[owner]) return { label: 'pool', detail: authorities[owner] };
  const prog = ownerProgram ? KNOWN_PROGRAMS[ownerProgram] : undefined;
  if (prog) {
    if (prog.kind === 'launchpad') return { label: 'curve', detail: `${prog.name} bonding curve` };
    if (prog.kind === 'amm' || prog.kind === 'orderbook') return { label: 'pool', detail: `${prog.name} pool` };
    if (prog.kind === 'locker') return { label: 'locker', detail: `${prog.name} vesting/lock` };
    if (prog.kind === 'multisig') return { label: 'program', detail: prog.name };
  }
  if (isPda(owner)) return { label: 'program', detail: 'Program-controlled account' };
  // Custodial hot wallets float thousands of SOL; a launch insider does not.
  if (ownerProgram === '11111111111111111111111111111111' && lamports >= 1_000 * 1e9) {
    return { label: 'exchange', detail: `Hot wallet holding ${Math.round(lamports / 1e9).toLocaleString('en-US')} SOL (likely exchange custody)` };
  }
  return { label: 'wallet' };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
