'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { Finding, Grade, Severity } from '@/lib/scan/types';

export const GRADE_STYLE: Record<Grade, { color: string; ring: string; label: string; text: string }> = {
  LOW: { color: '#3FBF7F', ring: 'border-safe/50 bg-safe/10 text-safe', label: 'Low risk', text: 'text-safe' },
  ELEVATED: { color: '#F0A53A', ring: 'border-caution/50 bg-caution/10 text-caution', label: 'Elevated risk', text: 'text-caution' },
  HIGH: { color: '#D63B3B', ring: 'border-signal/60 bg-signal/10 text-signal', label: 'High risk', text: 'text-signal' },
  CRITICAL: { color: '#FF2D2D', ring: 'border-[#FF2D2D]/70 bg-crimson/25 text-[#FF5A5A]', label: 'Critical risk', text: 'text-[#FF5A5A]' },
};

export const SEV_STYLE: Record<Severity, { dot: string; label: string; text: string }> = {
  critical: { dot: 'bg-[#FF2D2D] shadow-[0_0_12px_#FF2D2D]', label: 'Critical', text: 'text-[#FF5A5A]' },
  high: { dot: 'bg-signal', label: 'High', text: 'text-signal' },
  medium: { dot: 'bg-caution', label: 'Medium', text: 'text-caution' },
  low: { dot: 'bg-[#C9B37A]', label: 'Low', text: 'text-[#C9B37A]' },
  info: { dot: 'bg-muted', label: 'Info', text: 'text-muted' },
  good: { dot: 'bg-safe', label: 'Pass', text: 'text-safe' },
};

export function RiskDial({ score, grade, size = 168 }: { score: number; grade: Grade; size?: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const style = GRADE_STYLE[grade];
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#302C2D" strokeWidth="8" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={style.color} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} style={{ filter: `drop-shadow(0 0 6px ${style.color}88)` }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="font-mono text-5xl font-extrabold tabular-nums" style={{ color: style.color }}>{score}</div>
        <div className="mt-0.5 text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: style.color }}>{grade}</div>
      </div>
    </div>
  );
}

export function GradeBadge({ grade, score }: { grade: Grade; score?: number }) {
  return (
    <span className={`chip ${GRADE_STYLE[grade].ring}`}>
      {grade}
      {score !== undefined ? <span className="font-mono">{score}</span> : null}
    </span>
  );
}

export function Section({ title, kicker, children, right }: { title: string; kicker?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card p-5 md:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          {kicker ? <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">{kicker}</div> : null}
          <h2 className="text-lg font-bold">{title}</h2>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-graphite/60 bg-ink/50 p-3.5">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 font-mono text-lg font-bold tabular-nums ${tone ?? ''}`}>{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

export function Address({ value, href, short = true }: { value: string; href?: string; short?: boolean }) {
  const [copied, setCopied] = useState(false);
  const label = short && value.length > 14 ? `${value.slice(0, 5)}…${value.slice(-5)}` : value;
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
      {href ? (
        <Link href={href} className="text-bone underline decoration-graphite underline-offset-4 hover:decoration-signal">{label}</Link>
      ) : (
        <span className="text-bone">{label}</span>
      )}
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
        className="rounded border border-graphite px-1 text-[10px] text-muted hover:text-bone"
        aria-label="Copy address"
      >
        {copied ? 'ok' : 'copy'}
      </button>
    </span>
  );
}

function evidenceHref(href?: string): { href: string; external: boolean } | null {
  if (!href) return null;
  return { href, external: href.startsWith('http') };
}

export function FindingRow({ f }: { f: Finding }) {
  const s = SEV_STYLE[f.severity];
  return (
    <div className="rounded-xl border border-graphite/60 bg-ink/40 p-4">
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${s.dot}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[11px] font-bold uppercase tracking-wider ${s.text}`}>{s.label}</span>
            <span className="text-[11px] uppercase tracking-wider text-muted">{f.category}</span>
          </div>
          <div className="mt-1 font-semibold leading-snug">{f.title}</div>
          <p className="mt-1 text-sm leading-relaxed text-muted">{f.detail}</p>
          {f.evidence?.length ? (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {f.evidence.map((e, i) => {
                const link = evidenceHref(e.href);
                return (
                  <div key={i} className="text-xs text-muted">
                    {e.label}:{' '}
                    {link ? (
                      link.external ? (
                        <a href={link.href} target="_blank" rel="noreferrer noopener" className="font-mono text-bone underline decoration-graphite underline-offset-4 hover:decoration-signal">
                          {short(e.value)}
                        </a>
                      ) : (
                        <Link href={link.href} className="font-mono text-bone underline decoration-graphite underline-offset-4 hover:decoration-signal">{short(e.value)}</Link>
                      )
                    ) : (
                      <span className="font-mono text-bone">{short(e.value)}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function short(v: string) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,90}$/.test(v) ? `${v.slice(0, 6)}…${v.slice(-6)}` : v.length > 70 ? `${v.slice(0, 67)}...` : v;
}

export function Findings({ findings }: { findings: Finding[] }) {
  const [showAll, setShowAll] = useState(false);
  const risks = findings.filter((f) => f.severity !== 'good' && f.severity !== 'info');
  const rest = findings.filter((f) => f.severity === 'good' || f.severity === 'info');
  return (
    <div className="space-y-3">
      {risks.length === 0 ? <div className="rounded-xl border border-safe/30 bg-safe/5 p-4 text-sm text-safe">No risk findings. Still treat new tokens as speculative.</div> : null}
      {risks.map((f) => (
        <FindingRow key={f.id + f.title} f={f} />
      ))}
      {rest.length ? (
        <button type="button" className="text-sm text-muted underline underline-offset-4 hover:text-bone" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Hide' : 'Show'} {rest.length} passed checks and notes
        </button>
      ) : null}
      {showAll ? rest.map((f) => <FindingRow key={f.id + f.title} f={f} />) : null}
    </div>
  );
}

export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
  if (n === 0) return '$0';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(n < 1 ? 4 : 0)}`;
}

export function ago(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return 'unknown';
  const s = Math.max(0, Date.now() / 1000 - unixSeconds);
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

export function ScanSteps({ steps }: { steps: string[] }) {
  return (
    <div className="card scan-line mx-auto max-w-xl p-6">
      <div className="text-sm font-semibold text-signal">The hawk is circling...</div>
      <ul className="mt-3 space-y-2 text-sm text-muted">
        {steps.map((s, i) => (
          <li key={s} className="flex items-center gap-2 animate-pulsefade" style={{ animationDelay: `${i * 0.25}s` }}>
            <span className="h-1.5 w-1.5 rounded-full bg-signal" />
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}
