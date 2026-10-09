'use client';

import { useEffect, useState } from 'react';
import type { TokenReport } from '@/lib/scan/types';
import { GRADE_COPY } from '@/lib/scan/score';
import { pctText, plural } from '@/lib/format';
import { AiVerdictPanel } from './AiVerdictPanel';
import { FundingChain } from './FundingChain';
import { ShareBar } from './ShareBar';
import { Address, Findings, RiskDial, ScanSteps, Section, Stat, ago, usd, GRADE_STYLE } from './ui';
import { DeepChecks } from './DeepChecks';
import { AskInline } from './AskInline';
import { TokenLogo } from './TokenLogo';

const STEPS = [
  'Reading mint authorities and Token-2022 extensions',
  'Locating the creation transaction and the launch block',
  'Tracing the deployer and its funding chain',
  'Classifying the top holders (pools, curves, exchanges, wallets)',
  'Pulling market data and checking the website',
  'Comparing against Scam DNA of flagged tokens',
];

export function TokenReportView({ mint }: { mint: string }) {
  const [report, setReport] = useState<TokenReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limited, setLimited] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/scan/token?mint=${mint}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          if (r.status === 402 && alive) setLimited(true);
          throw new Error(data.error ?? 'Scan failed');
        }
        return data as TokenReport;
      })
      .then((d) => alive && setReport(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Scan failed'));
    return () => {
      alive = false;
    };
  }, [mint]);

  if (error) {
    return (
      <div className="mx-auto max-w-xl py-24 text-center">
        <div className="text-lg font-bold">{limited ? 'Daily free limit reached' : 'Scan failed'}</div>
        <p className="mt-2 text-muted">{error}</p>
        {limited ? (
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <a href="/#pricing" className="btn-primary">Go Pro for unlimited scans</a>
            <a href="/account" className="btn-ghost">Already Pro? Sign in</a>
          </div>
        ) : /not a token mint/i.test(error) ? (
          <a href={`/wallet/${mint}`} className="btn-primary mt-6">Scan it as a wallet</a>
        ) : null}
      </div>
    );
  }
  if (!report) return <div className="px-4 py-20"><ScanSteps steps={STEPS} /></div>;

  const r = report;
  const g = GRADE_STYLE[r.risk.grade];
  const title = `${r.token.name ?? 'Unknown token'}${r.token.symbol ? ` ($${r.token.symbol})` : ''}`;
  const topRisk = r.findings.find((f) => f.weight > 0);
  // Reports cached before these fields existed lack them.
  const devTransfers = r.launch?.devTransfers ?? [];
  const devRecipients = devTransfers.reduce((s, t) => s + t.recipients, 0);
  const devLockedPct = (r.launch?.devLocks ?? []).reduce((s, x) => s + x.pctOfSupply, 0);
  const devBurnedPct = (r.launch?.devBurns ?? []).reduce((s, x) => s + x.pctOfSupply, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      {/* Header */}
      <div className="card relative overflow-hidden p-6 md:p-8">
        <div className="pointer-events-none absolute inset-0 glow-top opacity-70" />
        <div className="relative flex flex-col gap-8 md:flex-row md:items-center">
          <RiskDial score={r.risk.score} grade={r.risk.grade} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <TokenLogo src={r.token.image} label={r.token.symbol ?? r.token.name ?? r.mint} size="md" />
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-extrabold tracking-tight md:text-3xl">{title}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <Address value={r.mint} />
                  <span>{r.program === 'spl-token-2022' ? 'Token-2022' : 'SPL Token'}</span>
                  {r.launch?.launchpad ? <span>via {r.launch.launchpad}</span> : null}
                  <span>scanned {new Date(r.scannedAt).toISOString().slice(11, 16)} UTC · {(r.durationMs / 1000).toFixed(1)}s · {r.rpcCalls} RPC calls</span>
                </div>
              </div>
            </div>
            <div className={`mt-4 text-lg font-bold ${g.text}`}>{GRADE_COPY[r.risk.grade].label}</div>
            <p className="mt-1 max-w-2xl text-sm text-bone/80">{GRADE_COPY[r.risk.grade].tone}</p>
            <div className="mt-5">
              <ShareBar path={`/token/${r.mint}`} text={`RugHawk scan of ${title}: ${r.risk.grade} risk (${r.risk.score}/100).${topRisk ? ` ${topRisk.title}.` : ''}`} />
            </div>
          </div>
        </div>
      </div>

      <AiVerdictPanel kind="token" address={r.mint} score={r.risk.score} />

      <AskInline kind="token" address={r.mint} label={r.token.symbol ? `$${r.token.symbol}` : r.token.name} />

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <Section title="Findings" kicker={`${r.risk.counts.critical} critical · ${r.risk.counts.high} high · ${r.risk.counts.medium} medium`}>
          <Findings findings={r.findings} />
          {r.partial.length ? (
            <div className="mt-4 rounded-xl border border-caution/30 bg-caution/5 p-3 text-xs text-caution">
              Not fully checked: {r.partial.join(' · ')}
            </div>
          ) : null}
        </Section>

        <div className="space-y-6">
          <Section title="Launch forensics" kicker="Creation block">
            {r.launch?.reached ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Launched" value={ago(r.launch.createdAt)} hint={r.launch.launchpad ?? undefined} />
                  <Stat label="Dev buy at creation" value={r.launch.devInitialPct !== null ? `${r.launch.devInitialPct.toFixed(2)}%` : 'n/a'} />
                  <Stat label="Bundled wallets" value={r.launch.bundled.wallets.length} hint={`${r.launch.bundled.pctOfSupply.toFixed(2)}% of supply`} tone={r.launch.bundled.wallets.length >= 3 ? 'text-signal' : ''} />
                  <Stat label="Dev sells" value={r.launch.devSells.length} hint={r.launch.devSells[0]?.secondsAfterLaunch != null ? `first at +${r.launch.devSells[0].secondsAfterLaunch}s` : 'none found'} tone={r.launch.devSells.length ? 'text-signal' : 'text-safe'} />
                  <Stat label="Dev holds now" value={r.launch.devCurrentPct != null ? `${r.launch.devCurrentPct.toFixed(2)}%` : 'n/a'} hint="of supply" />
                  <Stat label="Dev transfers" value={devTransfers.length} hint={devRecipients ? `to ${plural(devRecipients, 'wallet')}` : 'none found'} tone={devRecipients >= 10 ? 'text-signal' : ''} />
                  <Stat label="Dev locked" value={pctText(devLockedPct)} hint={r.launch.devLocks?.[0] ? `in ${r.launch.devLocks[0].locker}` : 'of supply'} />
                  <Stat label="Dev burned" value={pctText(devBurnedPct)} hint="of supply" tone={devBurnedPct > 0 ? 'text-safe' : ''} />
                </div>
                {r.launch.deployer ? <div className="text-xs text-muted">Deployer: <Address value={r.launch.deployer} href={`/wallet/${r.launch.deployer}`} /></div> : null}
                {r.launch.creationSignature ? (
                  <a className="text-xs text-muted underline underline-offset-4 hover:text-bone" href={`https://solscan.io/tx/${r.launch.creationSignature}`} target="_blank" rel="noreferrer noopener">Creation transaction on Solscan</a>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted">{r.findings.find((f) => f.id === 'LAUNCH_WINDOW_PASSED' || f.id === 'LAUNCH_NOT_LOCATED')?.detail ?? 'Not available.'}</p>
            )}
          </Section>

          {r.deployer ? (
            <Section title="Deployer dossier" kicker="Who launched it">
              <div className="mb-4 grid grid-cols-2 gap-3">
                <Stat label="Wallet age at launch" value={r.deployer.ageHoursAtLaunch !== null ? `${r.deployer.ageHoursAtLaunch}h` : 'old / deep'} tone={r.deployer.ageHoursAtLaunch !== null && r.deployer.ageHoursAtLaunch < 24 ? 'text-signal' : ''} />
                <Stat label="Other tokens minted" value={r.deployer.tokensCreated.length} hint={`in last ${r.deployer.sampleSize} txs`} tone={r.deployer.tokensCreated.length >= 2 ? 'text-signal' : ''} />
              </div>
              <FundingChain chain={r.deployer.fundingChain} startLabel="Deployer" />
            </Section>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Holders" kicker="Top accounts, classified">
          {r.holders ? (
            <>
              <div className="mb-4 grid grid-cols-3 gap-3">
                <Stat label="Top 10 wallets" value={`${r.holders.top10WalletPct.toFixed(1)}%`} hint="pools excluded" />
                <Stat label="In pools/curves" value={`${r.holders.poolPct.toFixed(1)}%`} />
                <Stat label="Burned" value={`${r.holders.burnedPct.toFixed(1)}%`} />
              </div>
              <div className="overflow-hidden rounded-xl border border-graphite/60">
                <table className="w-full text-left text-xs">
                  <thead className="bg-ink/60 text-muted">
                    <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Owner</th><th className="px-3 py-2">Type</th><th className="px-3 py-2 text-right">Supply</th></tr>
                  </thead>
                  <tbody>
                    {r.holders.top.slice(0, 12).map((h, i) => (
                      <tr key={h.tokenAccount} className="border-t border-graphite/40">
                        <td className="px-3 py-2 text-muted">{i + 1}</td>
                        <td className="px-3 py-2">{h.owner ? <Address value={h.owner} href={`/wallet/${h.owner}`} /> : '?'}</td>
                        <td className="px-3 py-2"><span className={`chip ${h.label === 'wallet' || h.label === 'deployer' ? 'border-graphite text-bone' : 'border-safe/40 text-safe'} ${h.label === 'deployer' ? '!border-signal/60 !text-signal' : ''}`} title={h.labelDetail}>{h.label}</span></td>
                        <td className="px-3 py-2 text-right font-mono">{h.pct.toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">Holder data unavailable.</p>
          )}
        </Section>

        <div className="space-y-6">
          <Section title="Market" kicker="DexScreener">
            {r.market ? (
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Liquidity" value={r.market.totalLiquidityUsd === 0 && /pump|moonshot|launchlab|dbc/i.test(r.market.dex) ? 'Curve' : usd(r.market.totalLiquidityUsd)} hint={`${r.market.pairs} pair${r.market.pairs > 1 ? 's' : ''} · ${r.market.dex}`} />
                <Stat label="Market cap" value={usd(r.market.marketCap ?? r.market.fdv)} />
                <Stat label="24h volume" value={usd(r.market.volume24h)} hint={r.market.buys24h !== null ? `${plural(r.market.buys24h, 'buy')} / ${plural(r.market.sells24h ?? 0, 'sell')}` : undefined} />
                <Stat label="1h change" value={r.market.priceChange1h !== null ? `${r.market.priceChange1h > 0 ? '+' : ''}${r.market.priceChange1h.toFixed(1)}%` : 'n/a'} tone={(r.market.priceChange1h ?? 0) < 0 ? 'text-signal' : 'text-safe'} />
                <a href={r.market.url} target="_blank" rel="noreferrer noopener" className="col-span-2 text-xs text-muted underline underline-offset-4 hover:text-bone">Open the pair on DexScreener</a>
              </div>
            ) : (
              <p className="text-sm text-muted">No DEX pair indexed.</p>
            )}
          </Section>

          <Section title="Authorities & extensions" kicker="On-chain capabilities">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between gap-3"><span className="text-muted">Mint authority</span>{r.authorities.mint ? <Address value={r.authorities.mint} href={`/wallet/${r.authorities.mint}`} /> : <span className="text-safe">revoked</span>}</div>
              <div className="flex justify-between gap-3"><span className="text-muted">Freeze authority</span>{r.authorities.freeze ? <Address value={r.authorities.freeze} href={`/wallet/${r.authorities.freeze}`} /> : <span className="text-safe">revoked</span>}</div>
              <div className="flex justify-between gap-3"><span className="text-muted">Metadata</span><span className={r.token.isMutable ? 'text-caution' : 'text-safe'}>{r.token.metadataSource === 'none' ? 'none' : r.token.isMutable ? 'mutable' : 'locked'}</span></div>
              {r.extensions.map((e) => (
                <div key={e.name} className="flex justify-between gap-3"><span className="text-muted">{e.name}</span><span className="text-right text-xs">{e.detail}</span></div>
              ))}
            </div>
          </Section>
        </div>
      </div>

      <DeepChecks mint={r.mint} website={r.socials.website} socials={r.socials} dna={r.dna} />
    </div>
  );
}
