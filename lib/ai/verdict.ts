import type { AiBinding } from '../env';
import type { AiVerdict, ScanReport, TokenReport, WalletReport } from '../scan/types';
import { generateStructured } from './workers-ai';

const SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'One punchy sentence, max 14 words.' },
    summary: { type: 'string', description: '2 to 4 sentences in plain English.' },
    topRisks: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    watch: { type: 'array', items: { type: 'string' }, maxItems: 3, description: 'What to monitor next.' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
  required: ['headline', 'summary', 'topRisks', 'watch', 'confidence'],
};

const SYSTEM = `You are RugHawk, a Solana on-chain forensic analyst.
You explain a deterministic scan to a trader in plain English.
Rules:
- Use ONLY the facts in the scan. Never invent numbers, names, addresses or events.
- The risk score and grade are final; explain them, do not argue with them.
- Lead with the single most dangerous capability or behavior.
- If modules were skipped (partial), say what was not checked.
- No financial advice, no price predictions, no hype. Direct, calm, specific.
- Never use the em dash character.`;

/** Compact, model-friendly digest of a report: the facts that matter, nothing else. */
export function digest(report: ScanReport): Record<string, unknown> {
  const findings = report.findings
    .filter((f) => f.severity !== 'good' || report.findings.length < 8)
    .slice(0, 14)
    .map((f) => `${f.severity.toUpperCase()}: ${f.title}`);
  if (report.kind === 'token') {
    const r = report as TokenReport;
    return {
      kind: 'token',
      name: r.token.name,
      symbol: r.token.symbol,
      program: r.program,
      risk: r.risk,
      authorities: r.authorities,
      launch: r.launch?.reached
        ? {
            launchpad: r.launch.launchpad,
            createdAt: r.launch.createdAt ? new Date(r.launch.createdAt * 1000).toISOString() : null,
            devInitialPct: r.launch.devInitialPct,
            bundledWallets: r.launch.bundled.wallets.length,
            bundledPct: r.launch.bundled.pctOfSupply,
            devSells: r.launch.devSells.length,
          }
        : 'not reached',
      deployer: r.deployer
        ? { ageHoursAtLaunch: r.deployer.ageHoursAtLaunch, otherTokens: r.deployer.tokensCreated.length, funding: r.deployer.fundingChain.map((h) => h.kind) }
        : null,
      holders: r.holders ? { top10WalletPct: r.holders.top10WalletPct, largestWalletPct: r.holders.largestWalletPct } : null,
      market: r.market ? { dex: r.market.dex, liquidityUsd: Math.round(r.market.totalLiquidityUsd), marketCap: r.market.marketCap } : null,
      dnaMatches: r.dna.length,
      findings,
      partial: r.partial,
    };
  }
  const w = report as WalletReport;
  return {
    kind: 'wallet',
    accountType: w.accountType,
    label: w.label,
    solBalance: w.solBalance,
    risk: w.risk,
    activity: w.activity,
    funding: w.funding.map((h) => h.kind),
    approvals: w.holdings?.delegated.length ?? 0,
    poisoning: w.poisoning.length,
    tokensCreated: w.tokensCreated.length,
    program: w.program ? { upgradeable: w.program.upgradeable, verified: w.program.verified } : null,
    findings,
    partial: w.partial,
  };
}

export async function aiVerdict(ai: AiBinding | undefined, gatewayId: string | undefined, report: ScanReport): Promise<AiVerdict | null> {
  if (!ai) return null;
  const subject = report.kind === 'token' ? `token ${report.token.symbol ?? report.mint}` : `${report.accountType} ${report.address}`;
  const out = await generateStructured<Omit<AiVerdict, 'model'>>(ai, gatewayId, {
    system: SYSTEM,
    user: `Explain this RugHawk scan of ${subject}.\nSCAN:\n${JSON.stringify(digest(report))}`,
    schema: SCHEMA,
    maxTokens: 700,
    // Same digest, same answer: let the gateway serve repeats from cache.
    gateway: { cacheTtl: 900, label: `verdict-${report.kind}` },
  });
  if (!out) return null;
  const v = out.data;
  const clean = (s: unknown) => String(s ?? '').replace(/\u2014/g, ', ').trim();
  return {
    headline: clean(v.headline).slice(0, 160),
    summary: clean(v.summary).slice(0, 900),
    topRisks: (Array.isArray(v.topRisks) ? v.topRisks : []).map(clean).filter(Boolean).slice(0, 3),
    watch: (Array.isArray(v.watch) ? v.watch : []).map(clean).filter(Boolean).slice(0, 3),
    confidence: ['low', 'medium', 'high'].includes(v.confidence) ? v.confidence : 'medium',
    model: out.model,
  };
}
