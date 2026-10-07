import type { AiBinding } from '../env';
import type { AiVerdict, ScanReport, TokenReport, WalletReport } from '../scan/types';
import { generateStructured } from './workers-ai';

const SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'Max 12 words: the single most dangerous behavior. No score, grade or token name.' },
    summary: { type: 'string', description: '2 to 4 sentences in plain English.' },
    topRisks: { type: 'array', items: { type: 'string' }, maxItems: 3, description: 'Plain-English consequences, no severity labels.' },
    watch: { type: 'array', items: { type: 'string' }, maxItems: 3, description: 'Concrete things to monitor next, phrased as actions.' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
  required: ['headline', 'summary', 'topRisks', 'watch', 'confidence'],
};

const SYSTEM = `You are RugHawk, a Solana on-chain forensic analyst writing for a trader who has 10 seconds.
You receive a deterministic scan. Explain it; never re-score it.

Output rules:
- headline: max 12 words. Name the single most dangerous behavior or capability in plain words (for example "Dev dumped their whole bag 5 seconds after launch"). Do not mention the score, the grade or the token name.
- summary: 2 to 3 sentences. What happened, what it lets someone do to buyers, and how sure the evidence is. If the scan is LOW risk, say what was checked and what still deserves caution.
- topRisks: up to 3 short consequences in plain English, each tied to a finding (for example "Insiders who bought in the launch block can sell into you"). No severity labels, no copying finding titles word for word.
- watch: up to 3 concrete things to monitor next, phrased as actions (for example "Watch whether the 2 sniper wallets start selling"). Never repeat a finding.
- confidence: high when on-chain facts drive the grade, medium when market or website data drive it, low when key modules were skipped.
Use only facts in the scan. No numbers that are not in the scan. No financial advice. Never use the em dash character.`;

/** Compact, model-friendly digest of a report: the facts that matter, nothing else. */
export function digest(report: ScanReport): Record<string, unknown> {
  const findings = report.findings
    .filter((f) => f.severity !== 'good' && f.severity !== 'info')
    .slice(0, 12)
    .map((f) => `${f.severity.toUpperCase()}: ${f.title}`);
  // Passed checks matter too: "mint authority revoked" is evidence, not silence.
  const passed = report.findings.filter((f) => f.severity === 'good').map((f) => f.title);
  const notes = report.findings.filter((f) => f.severity === 'info').slice(0, 4).map((f) => f.title);
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
      token2022Extensions: r.extensions.map((e) => e.name),
      dnaMatches: r.dna.length,
      findings,
      passed,
      notes,
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
    passed,
    notes,
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
