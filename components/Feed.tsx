'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { FeedRow } from '@/lib/db';
import { GRADE_STYLE, ago } from './ui';
import { TokenLogo } from './TokenLogo';
import type { Grade } from '@/lib/scan/types';

// Per-grade accents for a card: the hairline on top, a faint glow behind the
// score and the hover border. Written out in full so Tailwind keeps them.
const ACCENT: Record<Grade, { line: string; glow: string; hover: string }> = {
  CRITICAL: {
    line: 'via-crimson/80',
    glow: 'bg-[radial-gradient(90%_70%_at_100%_0%,rgba(255,77,94,0.12),transparent_70%)]',
    hover: 'hover:border-crimson/50 hover:shadow-[0_16px_40px_-20px_rgba(255,77,94,0.6)]',
  },
  HIGH: {
    line: 'via-signal/70',
    glow: 'bg-[radial-gradient(90%_70%_at_100%_0%,rgba(226,74,74,0.1),transparent_70%)]',
    hover: 'hover:border-signal/50 hover:shadow-[0_16px_40px_-20px_rgba(226,74,74,0.55)]',
  },
  ELEVATED: {
    line: 'via-caution/60',
    glow: 'bg-[radial-gradient(90%_70%_at_100%_0%,rgba(240,165,58,0.08),transparent_70%)]',
    hover: 'hover:border-caution/50 hover:shadow-[0_16px_40px_-20px_rgba(240,165,58,0.45)]',
  },
  LOW: {
    line: 'via-safe/60',
    glow: 'bg-[radial-gradient(90%_70%_at_100%_0%,rgba(63,191,127,0.08),transparent_70%)]',
    hover: 'hover:border-safe/50 hover:shadow-[0_16px_40px_-20px_rgba(63,191,127,0.45)]',
  },
};

// Cards shown before "Show all": six on a phone, eight in two columns, twelve
// in three or four, so every breakpoint ends on a full row.
function visibility(index: number, expanded: boolean): string {
  if (expanded || index < 6) return 'flex';
  if (index < 8) return 'hidden sm:flex';
  if (index < 12) return 'hidden lg:flex';
  return 'hidden';
}

function flagsOf(row: FeedRow): string[] {
  try {
    return JSON.parse(row.top_flags ?? '[]') as string[];
  } catch {
    return [];
  }
}

/** Score ring for a card: the grade's color, filled to the score. */
function ScoreRing({ score, color }: { score: number; color: string }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="relative h-11 w-11 shrink-0">
      <svg viewBox="0 0 44 44" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="22" cy="22" r={r} fill="none" stroke="#22252F" strokeWidth="4" />
        <circle cx="22" cy="22" r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} style={{ filter: `drop-shadow(0 0 4px ${color}88)` }} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-[13px] font-bold tabular-nums" style={{ color }}>
        <span className="sr-only">Risk score </span>
        {score}
      </span>
    </div>
  );
}

function FeedCard({ row, className }: { row: FeedRow; className: string }) {
  const grade = (row.grade in GRADE_STYLE ? row.grade : 'LOW') as Grade;
  const style = GRADE_STYLE[grade];
  const accent = ACCENT[grade];
  const short = `${row.address.slice(0, 4)}…${row.address.slice(-4)}`;
  const title = row.symbol ? `$${row.symbol}` : row.name ?? short;
  const subtitle = row.symbol && row.name && row.name !== row.symbol ? row.name : row.kind === 'wallet' ? (row.launchpad === 'program' ? 'Program' : 'Wallet') : short;
  const source = row.kind === 'token' ? row.launchpad : null;
  const when = Date.now() - row.updated_at < 60_000 ? 'just now' : ago(row.updated_at / 1000);
  return (
    <Link
      href={`/${row.kind}/${row.address}`}
      className={`relative flex-col gap-3 overflow-hidden rounded-xl border border-graphite/60 bg-ink/40 p-4 transition duration-200 hover:-translate-y-0.5 hover:bg-ink/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/60 ${accent.glow} ${accent.hover} ${className}`}
    >
      <span aria-hidden className={`pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent ${accent.line} to-transparent`} />
      <div className="flex items-center gap-3">
        <TokenLogo src={row.image} label={row.symbol ?? row.name ?? row.address} size="md" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold leading-tight text-bone">{title}</div>
          <div className="mt-0.5 truncate text-xs text-muted">{subtitle}</div>
        </div>
        <ScoreRing score={row.risk} color={style.color} />
      </div>
      <p className="line-clamp-2 min-h-[2.5rem] text-[13px] leading-5 text-bone/80">{flagsOf(row)[0] ?? 'No risk findings'}</p>
      <div className="mt-auto flex items-center justify-between gap-2 text-[11px] text-muted">
        <span className={`chip ${style.ring}`}>{grade}</span>
        <span className="min-w-0 truncate">{[source, when].filter(Boolean).join(' · ')}</span>
      </div>
    </Link>
  );
}

export function Feed() {
  const [rows, setRows] = useState<FeedRow[] | null>(null);
  const [stats, setStats] = useState<{ scans: number; flagged: number; tokens: number; wallets: number } | null>(null);
  const [mode, setMode] = useState<'risky' | 'all'>('risky');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch(`/api/feed?grade=${mode}`)
      .then((r) => r.json())
      .then((d) => {
        setRows(d.rows ?? []);
        setStats(d.stats ?? null);
      })
      .catch(() => setRows([]));
  }, [mode]);

  const count = rows?.length ?? 0;
  const show = (next: 'risky' | 'all') => {
    setMode(next);
    setExpanded(false);
  };

  return (
    <div className="card p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal opacity-60 [animation-duration:2s] motion-reduce:animate-none" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-signal" />
            </span>
            Live from the hawk
          </div>
          <h2 className="text-lg font-bold">{mode === 'risky' ? 'Latest tokens flagged HIGH or CRITICAL' : 'Latest scans'}</h2>
        </div>
        <div className="flex gap-2 text-xs">
          <button type="button" onClick={() => show('risky')} className={mode === 'risky' ? 'btn-primary !py-1.5' : 'btn-ghost !py-1.5'}>Flagged</button>
          <button type="button" onClick={() => show('all')} className={mode === 'all' ? 'btn-primary !py-1.5' : 'btn-ghost !py-1.5'}>All</button>
        </div>
      </div>
      {stats ? (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <span><span className="font-semibold tabular-nums text-bone">{stats.scans.toLocaleString('en-US')}</span> scans</span>
          <span><span className="font-semibold tabular-nums text-bone">{stats.flagged.toLocaleString('en-US')}</span> tokens flagged</span>
          <span><span className="font-semibold tabular-nums text-bone">{stats.wallets.toLocaleString('en-US')}</span> wallets profiled</span>
        </div>
      ) : null}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {rows === null ? (
          Array.from({ length: 8 }, (_, i) => (
            <div key={i} aria-hidden className={`${visibility(i, false)} flex-col gap-3 rounded-xl border border-graphite/40 bg-ink/30 p-4`}>
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 animate-pulse rounded-xl bg-graphite/60" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-2/3 animate-pulse rounded bg-graphite/60" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-graphite/40" />
                </div>
              </div>
              <div className="h-3 w-full animate-pulse rounded bg-graphite/40" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-graphite/40" />
            </div>
          ))
        ) : count === 0 ? (
          <div className="col-span-full py-6 text-sm text-muted">Nothing here yet. Scan a token to start the feed.</div>
        ) : (
          rows.map((r, i) => <FeedCard key={r.address} row={r} className={visibility(i, expanded)} />)
        )}
      </div>
      {!expanded ? (
        <div className={`mt-5 justify-center ${count > 6 ? 'flex' : 'hidden'} ${count > 8 ? 'sm:flex' : 'sm:hidden'} ${count > 12 ? 'lg:flex' : 'lg:hidden'}`}>
          <button type="button" onClick={() => setExpanded(true)} className="btn-ghost !py-2 text-xs">
            Show all {count}
          </button>
        </div>
      ) : null}
    </div>
  );
}
