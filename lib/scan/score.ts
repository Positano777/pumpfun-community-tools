import type { Finding, Grade, RiskSummary, Severity } from './types';

const ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info', 'good'];

/**
 * Noisy-OR aggregation: each finding is treated as an independent chance that
 * the asset is hostile, so risk = 1 - Π(1 - w_i). Ten small smells add up,
 * one critical dominates, and the score can never pass 100.
 *
 * A critical finding floors the score at 70 (CRITICAL band): a permanent
 * delegate is disqualifying no matter how good the rest of the report looks.
 */
export function scoreFindings(findings: Finding[]): RiskSummary {
  let safe = 1;
  for (const f of findings) {
    if (f.weight > 0) safe *= 1 - Math.min(f.weight, 95) / 100;
  }
  let score = Math.round((1 - safe) * 100);
  const counts = Object.fromEntries(ORDER.map((s) => [s, 0])) as Record<Severity, number>;
  for (const f of findings) counts[f.severity]++;
  if (counts.critical > 0) score = Math.max(score, 70);
  else if (counts.high > 0) score = Math.max(score, 45);
  return { score, grade: gradeFor(score), counts };
}

export function gradeFor(score: number): Grade {
  if (score >= 70) return 'CRITICAL';
  if (score >= 45) return 'HIGH';
  if (score >= 20) return 'ELEVATED';
  return 'LOW';
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity) || b.weight - a.weight);
}

export const GRADE_COPY: Record<Grade, { label: string; tone: string }> = {
  LOW: { label: 'Low risk', tone: 'No structural red flags found. Still size positions like it can go to zero.' },
  ELEVATED: { label: 'Elevated risk', tone: 'Several smells. Verify the flagged items before buying.' },
  HIGH: { label: 'High risk', tone: 'Structural red flags that enable a rug or a rigged market.' },
  CRITICAL: { label: 'Critical risk', tone: 'Do not interact. The token or wallet is built to take your funds.' },
};
