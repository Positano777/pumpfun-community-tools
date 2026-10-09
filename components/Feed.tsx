'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { FeedRow } from '@/lib/db';
import { GradeBadge } from './ui';
import { TokenLogo } from './TokenLogo';
import type { Grade } from '@/lib/scan/types';

export function Feed() {
  const [rows, setRows] = useState<FeedRow[] | null>(null);
  const [stats, setStats] = useState<{ scans: number; flagged: number; tokens: number; wallets: number } | null>(null);
  const [mode, setMode] = useState<'risky' | 'all'>('risky');

  useEffect(() => {
    fetch(`/api/feed?grade=${mode}`)
      .then((r) => r.json())
      .then((d) => {
        setRows(d.rows ?? []);
        setStats(d.stats ?? null);
      })
      .catch(() => setRows([]));
  }, [mode]);

  return (
    <div className="card p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">Live from the hawk</div>
          <h2 className="text-lg font-bold">{mode === 'risky' ? 'Latest tokens flagged HIGH or CRITICAL' : 'Latest scans'}</h2>
        </div>
        <div className="flex gap-2 text-xs">
          <button type="button" onClick={() => setMode('risky')} className={mode === 'risky' ? 'btn-primary !py-1.5' : 'btn-ghost !py-1.5'}>Flagged</button>
          <button type="button" onClick={() => setMode('all')} className={mode === 'all' ? 'btn-primary !py-1.5' : 'btn-ghost !py-1.5'}>All</button>
        </div>
      </div>
      {stats ? (
        <div className="mt-3 text-xs text-muted">{stats.scans.toLocaleString('en-US')} scans · {stats.flagged.toLocaleString('en-US')} tokens flagged · {stats.wallets.toLocaleString('en-US')} wallets profiled</div>
      ) : null}
      <div className="mt-4 divide-y divide-graphite/50">
        {rows === null ? (
          <div className="py-6 text-sm text-muted">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="py-6 text-sm text-muted">Nothing here yet. Scan a token to start the feed.</div>
        ) : (
          rows.map((r) => {
            const flags = (() => {
              try {
                return JSON.parse(r.top_flags ?? '[]') as string[];
              } catch {
                return [];
              }
            })();
            return (
              <Link key={r.address} href={`/${r.kind}/${r.address}`} className="flex items-center gap-3 py-3 hover:bg-ink/40">
                <TokenLogo src={r.image} label={r.symbol ?? r.name ?? r.address} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{r.symbol ? `$${r.symbol}` : r.name ?? `${r.address.slice(0, 6)}…`} <span className="font-normal text-muted">{r.launchpad ?? ''}</span></div>
                  <div className="truncate text-xs text-muted">{flags[0] ?? 'No risk findings'}</div>
                </div>
                <GradeBadge grade={r.grade as Grade} score={r.risk} />
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
