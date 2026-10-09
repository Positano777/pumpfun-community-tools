'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { WalletReport } from '@/lib/scan/types';
import { GRADE_COPY } from '@/lib/scan/score';
import { AiVerdictPanel } from './AiVerdictPanel';
import { FundingChain } from './FundingChain';
import { ShareBar } from './ShareBar';
import { AskInline } from './AskInline';
import { Address, Findings, RiskDial, ScanSteps, Section, Stat, ago, GRADE_STYLE } from './ui';

const STEPS = ['Identifying the account type', 'Reading activity history', 'Tracing first funding', 'Checking approvals and seizable tokens', 'Looking for address poisoning'];

export function WalletReportView({ address }: { address: string }) {
  const [report, setReport] = useState<WalletReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limited, setLimited] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/scan/wallet?address=${address}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          if (r.status === 402 && alive) setLimited(true);
          throw new Error(data.error ?? 'Scan failed');
        }
        return data as WalletReport;
      })
      .then((d) => alive && setReport(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Scan failed'));
    return () => {
      alive = false;
    };
  }, [address]);

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
        ) : null}
      </div>
    );
  }
  if (!report) return <div className="px-4 py-20"><ScanSteps steps={STEPS} /></div>;
  const r = report;
  const g = GRADE_STYLE[r.risk.grade];
  const typeLabel = r.accountType === 'program' ? 'Program' : r.accountType === 'pda' ? 'Program-owned account' : r.accountType === 'empty' ? 'Closed or unfunded wallet' : r.accountType === 'mint' ? 'Token mint' : r.accountType === 'token-account' ? 'Token account' : 'Wallet';

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div className="card relative overflow-hidden p-6 md:p-8">
        <div className="pointer-events-none absolute inset-0 glow-top opacity-70" />
        <div className="relative flex flex-col gap-8 md:flex-row md:items-center">
          <RiskDial score={r.risk.score} grade={r.risk.grade} />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">{typeLabel}{r.label ? ` · ${r.label}` : ''}</div>
            <h1 className="mt-1 break-all font-mono text-xl font-bold md:text-2xl">{r.address}</h1>
            <div className={`mt-4 text-lg font-bold ${g.text}`}>{GRADE_COPY[r.risk.grade].label}</div>
            <p className="mt-1 max-w-2xl text-sm text-bone/80">Counterparty risk: how dangerous it is to interact with this address. Exposure findings describe the owner's own wallet hygiene.</p>
            {r.accountType === 'mint' ? <Link href={`/token/${r.address}`} className="btn-primary mt-4">Open the token report</Link> : null}
            <div className="mt-5"><ShareBar path={`/wallet/${r.address}`} text={`RugHawk wallet scan: ${r.risk.grade} risk (${r.risk.score}/100).`} /></div>
          </div>
        </div>
      </div>

      <AiVerdictPanel kind="wallet" address={r.address} score={r.risk.score} />

      <AskInline kind="wallet" address={r.address} label={r.label} />

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <Section title="Findings" kicker={`${r.risk.counts.critical} critical · ${r.risk.counts.high} high · ${r.risk.counts.medium} medium`}>
          <Findings findings={r.findings} />
          {r.partial.length ? <div className="mt-4 rounded-xl border border-caution/30 bg-caution/5 p-3 text-xs text-caution">Not fully checked: {r.partial.join(' · ')}</div> : null}
        </Section>
        <div className="space-y-6">
          <Section title="Activity" kicker="On-chain history">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="SOL balance" value={r.solBalance.toLocaleString('en-US', { maximumFractionDigits: 3 })} />
              <Stat label="Transactions" value={`${r.activity.txCount.toLocaleString('en-US')}${r.activity.capped ? '+' : ''}`} hint={r.activity.perDay !== null ? `${r.activity.perDay}/day` : undefined} />
              <Stat label="First seen" value={r.activity.firstSeen ? ago(r.activity.firstSeen) : 'beyond window'} />
              <Stat label="Failed txs" value={`${Math.round(r.activity.failedRatio * 100)}%`} />
            </div>
          </Section>
          {r.program ? (
            <Section title="Program" kicker="Upgradeability & verification">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted">Upgradeable</span><span className={r.program.upgradeable ? 'text-caution' : 'text-safe'}>{r.program.upgradeable ? 'yes' : 'no'}</span></div>
                {r.program.upgradeAuthority ? <div className="flex justify-between gap-2"><span className="text-muted">Authority</span><Address value={r.program.upgradeAuthority} href={`/wallet/${r.program.upgradeAuthority}`} /></div> : null}
                <div className="flex justify-between"><span className="text-muted">Verified build</span><span className={r.program.verified ? 'text-safe' : 'text-muted'}>{r.program.verified === null ? 'unknown' : r.program.verified ? 'yes' : 'no'}</span></div>
                {r.program.lastDeploySlot ? <div className="flex justify-between"><span className="text-muted">Last deploy slot</span><span className="font-mono">{r.program.lastDeploySlot.toLocaleString('en-US')}</span></div> : null}
              </div>
            </Section>
          ) : null}
          {r.funding.length ? (
            <Section title="Funding trail" kicker="Where the first SOL came from">
              <FundingChain chain={r.funding} startLabel="This address" />
            </Section>
          ) : null}
        </div>
      </div>

      {r.holdings || r.counterparties.length ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {r.holdings ? (
            <Section title="Exposure" kicker="Approvals & token accounts" right={<Link href="/shield" className="btn-primary !py-2 text-xs">Fix in Shield</Link>}>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Live approvals" value={r.holdings.delegated.length} tone={r.holdings.delegated.length ? 'text-signal' : 'text-safe'} />
                <Stat label="Seizable tokens" value={r.holdings.permanentDelegateTokens.length} tone={r.holdings.permanentDelegateTokens.length ? 'text-caution' : ''} />
                <Stat label="Reclaimable rent" value={`${r.holdings.reclaimableSol.toFixed(4)}`} hint={`SOL in ${r.holdings.empty} empty accounts`} />
              </div>
            </Section>
          ) : null}
          {r.counterparties.length ? (
            <Section title="Recent counterparties" kicker="SOL transfers in the latest transactions">
              <ul className="space-y-1.5 text-sm">
                {r.counterparties.map((c) => (
                  <li key={c.address} className="flex justify-between gap-2">
                    <Address value={c.address} href={`/wallet/${c.address}`} />
                    <span className="text-xs text-muted">{c.label ?? ''} {c.count}x</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
