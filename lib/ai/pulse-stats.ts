/**
 * Market pulse statistics: deterministic counts over the engine's own
 * findings for the flagged launches of a window. Client-safe (the home page
 * renders the labels); the model that phrases them lives in pulse.ts.
 */
import type { FeedRow } from '../db';

export const PULSE_PATTERNS = {
  bundled: /bought in the launch block/i,
  spray: /sprayed dust/i,
  devExit: /Deployer (dumped|sold)|Heavy selling/i,
  serial: /minted \d+ other token|Same deployer behind/i,
  impersonation: /Impersonates|Uses the name of|lookalike characters|a major brand/i,
  concentration: /Top 10 wallets hold|One wallet holds/i,
  authority: /Permanent delegate|authority is live|cannot be transferred|Transfer hook runs/i,
  freshDeployer: /Deployer wallet was/i,
  drainer: /connect a wallet to claim|suspicious wallet code/i,
  thinLiquidity: /Liquidity is only|Thin liquidity/i,
} as const;

export type PatternKey = keyof typeof PULSE_PATTERNS;

export const PATTERN_LABELS: Record<PatternKey, string> = {
  bundled: 'bundled launches',
  spray: 'fake-holder sprays',
  devExit: 'deployer exits',
  serial: 'serial launchers',
  impersonation: 'impersonations',
  concentration: 'whale-held supplies',
  authority: 'live issuer powers',
  freshDeployer: 'fresh deployer wallets',
  drainer: 'drainer websites',
  thinLiquidity: 'thin liquidity',
};

export interface PulseStats {
  windowHours: number;
  flagged: number;
  critical: number;
  high: number;
  launchpads: Record<string, number>;
  patterns: Record<PatternKey, number>;
  latest: { symbol: string | null; grade: string; risk: number; minutesAgo: number }[];
  totals: { scans: number; flagged: number; tokens: number; wallets: number };
}

/** Deterministic counts over the flagged tokens of the window. */
export function pulseStats(rows: FeedRow[], now = Date.now(), windowHours = 24): Omit<PulseStats, 'totals'> {
  const since = now - windowHours * 3_600_000;
  const recent = rows.filter((r) => r.kind === 'token' && r.updated_at >= since && (r.grade === 'HIGH' || r.grade === 'CRITICAL'));
  const patterns = Object.fromEntries(Object.keys(PULSE_PATTERNS).map((k) => [k, 0])) as Record<PatternKey, number>;
  const launchpads: Record<string, number> = {};
  for (const r of recent) {
    let flags: string[] = [];
    try {
      flags = JSON.parse(r.top_flags ?? '[]') as string[];
    } catch {
      flags = [];
    }
    for (const [key, re] of Object.entries(PULSE_PATTERNS) as [PatternKey, RegExp][]) {
      if (flags.some((f) => re.test(f))) patterns[key] += 1;
    }
    if (r.launchpad) launchpads[r.launchpad] = (launchpads[r.launchpad] ?? 0) + 1;
  }
  return {
    windowHours,
    flagged: recent.length,
    critical: recent.filter((r) => r.grade === 'CRITICAL').length,
    high: recent.filter((r) => r.grade === 'HIGH').length,
    launchpads,
    patterns,
    latest: recent.slice(0, 3).map((r) => ({ symbol: r.symbol, grade: r.grade, risk: r.risk, minutesAgo: Math.max(0, Math.round((now - r.updated_at) / 60_000)) })),
  };
}

export interface Pulse {
  headline: string;
  body: string;
  watch: string;
  stats: PulseStats;
  generated: boolean;
  at: number;
}

/** Readable text when no model is available or the window is empty. */
export function fallbackPulse(s: Omit<PulseStats, 'totals'>): { headline: string; body: string; watch: string } {
  if (!s.flagged) {
    return {
      headline: 'Quiet skies: nothing flagged in the last 24 hours',
      body: 'No token scanned in the last day graded HIGH or CRITICAL. The engine keeps watching every launch it is pointed at.',
      watch: 'Paste any fresh mint before you buy; a quiet day is not a safe day.',
    };
  }
  const top = (Object.entries(s.patterns) as [PatternKey, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 2);
  const parts = top.map(([k, n]) => `${n} ${PATTERN_LABELS[k]}`);
  return {
    headline: `${s.flagged} launch${s.flagged === 1 ? '' : 'es'} flagged in the last 24 hours`,
    body: `${s.critical} graded CRITICAL and ${s.high} HIGH.${parts.length ? ` The engine saw ${parts.join(' and ')}.` : ''}`,
    watch: 'Check who bought in the launch block and whether the deployer still holds its bag.',
  };
}

