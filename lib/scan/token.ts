import type { Finding, TokenReport } from './types';
import type { ScanContext } from './context';
import { guarded } from './context';
import { analyzeMint, type ParsedMint } from './mint';
import { loadMetadata } from './metadata';
import { analyzeHolders } from './holders';
import { loadMarket, marketFindings } from './market';
import { analyzeLaunch, pumpFunCurve, type LaunchHints } from './launch';
import { profileDeployer } from './deployer';
import { analyzeWebsite } from './website';
import { impersonationFindings } from './impersonation';
import { scoreFindings, sortFindings } from './score';
import { BLUE_CHIP_MINTS, KNOWN_PROGRAMS, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from '../solana/known';
import { isAddress } from '../solana/address';

export class NotAMintError extends Error {
  constructor(public accountType: string) {
    super(`Address is not a token mint (${accountType})`);
    this.name = 'NotAMintError';
  }
}

interface JsonParsedAccount {
  owner: string;
  executable: boolean;
  data: { program?: string; parsed?: { type?: string; info?: Record<string, unknown> } } | [string, string];
}

export async function fetchMint(ctx: ScanContext, mint: string): Promise<ParsedMint> {
  const res = await ctx.rpc.call<{ value: JsonParsedAccount | null }>('getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  const acct = res.value;
  if (!acct) throw new NotAMintError('empty');
  const data = Array.isArray(acct.data) ? null : acct.data;
  if (!data?.parsed || data.parsed.type !== 'mint' || (data.program !== 'spl-token' && data.program !== 'spl-token-2022')) {
    throw new NotAMintError(acct.executable ? 'program' : data?.parsed?.type ?? 'account');
  }
  const info = data.parsed.info as Record<string, unknown>;
  return {
    program: data.program,
    decimals: Number(info.decimals ?? 0),
    supply: String(info.supply ?? '0'),
    mintAuthority: (info.mintAuthority as string) ?? null,
    freezeAuthority: (info.freezeAuthority as string) ?? null,
    extensions: (info.extensions as ParsedMint['extensions']) ?? [],
  };
}

export async function scanToken(ctx: ScanContext, mint: string): Promise<TokenReport> {
  if (!isAddress(mint)) throw new Error('Invalid Solana address');
  const started = Date.now();
  const callsBefore = ctx.rpc.calls;
  const providersBefore = ctx.rpc.snapshot();
  const partial: string[] = [];

  const parsed = await fetchMint(ctx, mint);
  const uiSupply = Number(parsed.supply) / 10 ** parsed.decimals;
  const mintAnalysis = analyzeMint(mint, parsed);

  const metaP = guarded(partial, 'metadata', () => loadMetadata(ctx, mint, mintAnalysis.tokenMetadata), null);
  const marketP = guarded(partial, 'market', () => loadMarket(ctx, mint), null);
  const hints = async (): Promise<LaunchHints> => {
    const [m, mk, curve] = await Promise.all([metaP, marketP, pumpFunCurve(ctx, mint).catch(() => null)]);
    return {
      candidates: [curve?.creator, ...(m?.creators ?? []), m?.info.updateAuthority, parsed.mintAuthority, parsed.freezeAuthority].filter(
        (c): c is string => Boolean(c),
      ),
      finishedCurve: curve?.complete ? curve.curve : null,
      approxTime: mk?.pairCreatedAt ? Math.floor(mk.pairCreatedAt / 1000) : null,
    };
  };
  const [meta, market, launchRes] = await Promise.all([
    metaP,
    marketP,
    guarded(partial, 'launch', () => analyzeLaunch(ctx, { mint, uiSupply, decimals: parsed.decimals, tokenProgram: parsed.program === 'spl-token-2022' ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM }, hints), null),
  ]);

  const launch = launchRes?.launch ?? null;
  const deployer = launch?.deployer ?? null;

  const [holdersRes, deployerRes, websiteRes] = await Promise.all([
    guarded(partial, 'holders', () => analyzeHolders(ctx, mint, uiSupply, deployer), null),
    deployer ? guarded(partial, 'deployer', () => profileDeployer(ctx, deployer, launch?.createdAt ?? null, mint), null) : Promise.resolve(null),
    guarded(
      partial,
      'website',
      () =>
        analyzeWebsite(ctx, {
          metaWebsite: meta?.offchain?.website,
          metaTwitter: meta?.offchain?.twitter,
          metaTelegram: meta?.offchain?.telegram,
          dexWebsites: market?.websites ?? [],
          dexSocials: market?.socials ?? [],
        }),
      null,
    ),
  ]);

  const findings: Finding[] = [
    ...mintAnalysis.findings,
    ...(meta?.findings ?? []),
    ...(holdersRes?.findings ?? []),
    ...(launchRes?.findings ?? []),
    ...(deployerRes?.findings ?? []),
    ...(websiteRes?.findings ?? []),
  ];

  // Did the bundled launch buyers already exit? Cross-check against current holders.
  const bundleFinding = findings.find((f) => f.id === 'BUNDLED_LAUNCH' || f.id === 'LAUNCH_SNIPERS');
  if (bundleFinding && launch && holdersRes) {
    const bundled = new Set(launch.bundled.wallets);
    const still = holdersRes.stats.top.filter((h) => h.owner && bundled.has(h.owner));
    const stillPct = still.reduce((s, h) => s + h.pct, 0);
    bundleFinding.detail +=
      still.length === 0
        ? ' None of them is among the top holders any more: they already sold into later buyers.'
        : ` ${still.length} still hold ${stillPct.toFixed(2)}% of supply and can dump at any moment.`;
  }

  const onCurve = Boolean(launch?.launchpad && Object.values(KNOWN_PROGRAMS).some((p) => p.kind === 'launchpad' && p.name === launch.launchpad));
  if (!partial.some((p) => p.startsWith('market'))) findings.push(...marketFindings(market, ctx.now(), onCurve));

  const name = meta?.info.name ?? null;
  const symbol = meta?.info.symbol ?? null;
  findings.push(...impersonationFindings(mint, name, symbol));

  if (BLUE_CHIP_MINTS.has(mint)) {
    // Context matters: on a canonical blue chip the biggest balances are
    // exchanges, treasuries and protocol vaults, and most volume is off-DEX.
    const soften = new Set(['TOP10_CONCENTRATION', 'SINGLE_WHALE', 'LIQ_TO_MCAP', 'THIN_LIQUIDITY', 'LOW_LIQUIDITY', 'METADATA_MUTABLE', 'DEPLOYER_HOLDS', 'LAUNCH_NOT_LOCATED']);
    for (const f of findings) {
      if (!soften.has(f.id)) continue;
      f.severity = 'info';
      f.weight = 0;
      f.detail += ' Context: canonical mint of an established token, so large balances are mostly exchanges, treasuries and vaults, and DEX liquidity is a fraction of where it trades.';
    }
    findings.push({
      id: 'CANONICAL_MINT',
      severity: 'good',
      category: 'intel',
      title: 'Canonical mint of a major token',
      detail: 'This exact mint address is the real one on RugHawk\'s verified blue-chip list.',
      weight: 0,
    });
  }

  const sorted = sortFindings(findings);
  return {
    kind: 'token',
    version: 1,
    mint,
    scannedAt: ctx.now(),
    durationMs: Date.now() - started,
    rpcCalls: ctx.rpc.calls - callsBefore,
    rpcProviders: ctx.rpc.rolesSince(providersBefore),
    program: parsed.program,
    token: {
      name,
      symbol,
      image: meta?.info.image ?? market?.imageUrl ?? null,
      description: meta?.info.description ?? null,
      decimals: parsed.decimals,
      supply: parsed.supply,
      uiSupply,
      uri: meta?.info.uri ?? null,
      isMutable: meta?.info.isMutable ?? null,
      updateAuthority: meta?.info.updateAuthority ?? null,
      metadataSource: meta?.info.metadataSource ?? 'none',
    },
    authorities: { mint: parsed.mintAuthority, freeze: parsed.freezeAuthority },
    extensions: mintAnalysis.extensions,
    holders: holdersRes?.stats ?? null,
    market,
    launch,
    deployer: deployerRes?.profile ?? null,
    socials: websiteRes?.socials ?? { website: null, twitter: null, telegram: null, domain: null, domainRegisteredAt: null, domainAgeDays: null },
    findings: sorted,
    risk: scoreFindings(sorted),
    ai: null,
    dna: [],
    partial,
  };
}
