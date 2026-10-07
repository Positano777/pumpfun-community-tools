import type { DeployerProfile, Finding } from './types';
import type { ScanContext } from './context';
import { addressHistory, traceFunding } from './funding';
import { allInstructions } from '../rpc';
import { TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from '../solana/known';
import { shortAddress } from '../solana/address';

const SERIAL_SAMPLE = 20;

/**
 * Who launched this token? Wallet age at launch, how many other tokens the
 * same key minted recently, where its first SOL came from, and whether
 * RugHawk has flagged its earlier launches.
 */
export async function profileDeployer(
  ctx: ScanContext,
  deployer: string,
  launchedAt: number | null,
  currentMint: string,
): Promise<{ profile: DeployerProfile; findings: Finding[] }> {
  const history = await addressHistory(ctx, deployer, 2);
  const firstSeen = history.reachedStart ? history.sigs[history.sigs.length - 1]?.blockTime ?? null : null;
  const ageHoursAtLaunch = firstSeen && launchedAt ? Math.max(0, (launchedAt - firstSeen) / 3600) : null;

  // Serial-launcher sample: the most recent transactions, looking for mint creations.
  const sample = history.sigs.filter((s) => !s.err).slice(0, SERIAL_SAMPLE).map((s) => s.signature);
  const txs = await ctx.rpc.getTransactions(sample, 4);
  const created = new Map<string, { mint: string; signature: string; time: number | null }>();
  txs.forEach((tx, i) => {
    if (!tx) return;
    for (const ix of allInstructions(tx)) {
      if (ix.programId !== TOKEN_PROGRAM && ix.programId !== TOKEN_2022_PROGRAM) continue;
      if (typeof ix.parsed !== 'object' || !/^initializeMint/.test(ix.parsed?.type ?? '')) continue;
      const mint = ix.parsed?.info?.mint as string | undefined;
      if (mint && mint !== currentMint && !created.has(mint)) created.set(mint, { mint, signature: sample[i], time: tx.blockTime ?? null });
    }
  });
  const tokensCreated = [...created.values()];

  const [fundingChain, linked] = await Promise.all([
    traceFunding(ctx, deployer, 3, history).catch(() => []),
    ctx.history?.flaggedByDeployer(deployer, currentMint).catch(() => []) ?? Promise.resolve([]),
  ]);

  const profile: DeployerProfile = {
    address: deployer,
    solBalance: history.balanceSol,
    firstSeen,
    txCount: history.sigs.length,
    txCountCapped: !history.reachedStart,
    ageHoursAtLaunch: ageHoursAtLaunch === null ? null : Math.round(ageHoursAtLaunch * 10) / 10,
    fundingChain,
    tokensCreated,
    sampleSize: sample.length,
    linkedFlaggedScans: linked,
  };
  return { profile, findings: deployerFindings(profile) };
}

function deployerFindings(p: DeployerProfile): Finding[] {
  const out: Finding[] = [];
  if (p.ageHoursAtLaunch !== null && p.ageHoursAtLaunch < 72) {
    const fresh = p.ageHoursAtLaunch < 24;
    out.push({
      id: 'DEPLOYER_FRESH',
      severity: fresh ? 'high' : 'medium',
      category: 'deployer',
      title: `Deployer wallet was ${p.ageHoursAtLaunch < 1 ? 'minutes' : `${Math.round(p.ageHoursAtLaunch)}h`} old at launch`,
      detail: 'A wallet created just to launch is a burner: nothing ties the launcher to a reputation they could lose.',
      weight: fresh ? 18 : 8,
      evidence: [{ label: 'Deployer', value: p.address, href: `/wallet/${p.address}` }],
    });
  }

  const n = p.tokensCreated.length;
  if (n >= 2) {
    const severe = n >= 6;
    out.push({
      id: 'SERIAL_LAUNCHER',
      severity: severe ? 'critical' : 'high',
      category: 'deployer',
      title: `Deployer minted ${n} other token${n > 1 ? 's' : ''} in its last ${p.sampleSize} transactions`,
      detail: 'Serial launchers spray tokens and dump whichever one gets bids. In our field sample one wallet ran 90 launches in 36.7 hours; 1 trended, the wallet still ended net negative, paid for by buyers.',
      weight: severe ? 45 : 25,
      evidence: p.tokensCreated.slice(0, 5).map((t) => ({ label: 'Other mint', value: t.mint, href: `/token/${t.mint}` })),
    });
  }

  if (p.linkedFlaggedScans.length) {
    out.push({
      id: 'DEPLOYER_FLAGGED_BEFORE',
      severity: 'high',
      category: 'intel',
      title: `Same deployer behind ${p.linkedFlaggedScans.length} token${p.linkedFlaggedScans.length > 1 ? 's' : ''} RugHawk already flagged`,
      detail: 'This key launched tokens that scored HIGH or CRITICAL in earlier scans.',
      weight: 30,
      evidence: p.linkedFlaggedScans.slice(0, 5).map((s) => ({ label: s.symbol ?? shortAddress(s.address), value: `risk ${s.risk}`, href: `/token/${s.address}` })),
    });
  }

  const chain = p.fundingChain;
  const funder = chain[1];
  if (funder) {
    if (funder.kind === 'exchange-like') {
      out.push({
        id: 'FUNDED_BY_EXCHANGE',
        severity: 'info',
        category: 'funding',
        title: 'Deployer funded from an exchange-like hot wallet',
        detail: 'First SOL came from a high-volume wallet (exchange or market maker). Common and neutral; it also breaks the on-chain trail.',
        weight: 0,
        evidence: [{ label: 'Funder', value: funder.address, href: `/wallet/${funder.address}` }],
      });
    } else if (chain.length >= 3 && chain.slice(1).every((h) => h.kind === 'wallet')) {
      const freshLinks = chain.slice(0, -1).filter((h) => h.time && h.firstSeen !== null && h.time - (h.firstSeen ?? 0) < 86_400).length;
      out.push({
        id: 'LAYERED_FUNDING',
        severity: freshLinks >= 2 ? 'medium' : 'low',
        category: 'funding',
        title: `Funding passes through ${chain.length - 1} intermediate wallet${chain.length > 2 ? 's' : ''}`,
        detail: 'SOL hopped through fresh wallets before reaching the deployer. Layering like this is how operators keep launches unlinkable.',
        weight: freshLinks >= 2 ? 10 : 4,
        evidence: chain.slice(1).map((h) => ({ label: h.kind, value: h.address, href: `/wallet/${h.address}` })),
      });
    }
  }

  if (p.solBalance !== null && p.solBalance < 0.01 && p.txCount > 3) {
    out.push({
      id: 'DEPLOYER_DRAINED',
      severity: 'low',
      category: 'deployer',
      title: 'Deployer wallet is empty',
      detail: 'The launcher moved its SOL out after launch. Proceeds have already left.',
      weight: 5,
    });
  }
  return out;
}
