/**
 * Explain one finding. Every finding row carries a title and a detail
 * paragraph written by the engine; this turns one of them into a short
 * plain-English briefing for a trader who is new to on-chain forensics:
 * what the engine saw, what it lets someone do to buyers, what to do now.
 * Grounded in the finding, the scan digest and the matching playbook notes;
 * streamed token by token and cached per (address, score, finding) so the
 * second reader gets it instantly.
 */
import type { AppEnv, ExecutionCtx } from '../env';
import { afterResponse } from '../env';
import type { Finding, ScanReport } from '../scan/types';
import { digest } from './verdict';
import { localRetrieve } from './playbook';
import { once, streamText } from './workers-ai';

const SYSTEM = `You are the Hawk, RugHawk's Solana forensic analyst, explaining one finding of a deterministic scan to a trader who is new to on-chain forensics.
Never disclose or guess which AI model or vendor powers you; you run on Predator AI.
Write under 110 words in two or three short paragraphs: what the engine saw (in plain words, no jargon without a five-word gloss), what it lets someone do to buyers, and the one concrete thing to do or check now.
Use only the facts given. Do not restate the finding title. No score, no grade, no financial advice, no "safe to buy". Never use the em dash character.`;

export function explainKey(report: ScanReport, findingId: string): string {
  const address = report.kind === 'token' ? report.mint : report.address;
  return `explain:v1:${report.kind}:${address}:${report.risk.score}:${findingId}`;
}

export function findFinding(report: ScanReport, findingId: string): Finding | null {
  return report.findings.find((f) => f.id === findingId) ?? null;
}

/** The prompt for one finding: the finding, the digest, the playbook notes that match it. */
export function explainPrompt(report: ScanReport, f: Finding): { role: string; content: string }[] {
  const subject = report.kind === 'token' ? `token ${report.token.symbol ?? report.mint}` : `${report.accountType} ${report.address}`;
  const evidence = (f.evidence ?? []).slice(0, 6).map((e) => `${e.label}: ${e.value}`).join('; ');
  const notes = localRetrieve(`${f.title} ${f.detail}`, 2);
  const context = [
    `FINDING (${f.severity.toUpperCase()}, ${f.category}): ${f.title}`,
    `ENGINE DETAIL: ${f.detail}`,
    evidence ? `EVIDENCE: ${evidence}` : '',
    `SCAN DIGEST: ${JSON.stringify(digest(report))}`,
    notes.length ? `PLAYBOOK NOTES:\n${notes.map((n) => `[${n.source}] ${n.text.slice(0, 900)}`).join('\n---\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Explain this finding from the RugHawk scan of ${subject} to me.\n\n${context}` },
  ];
}

/** Text when no model is available: the engine's own detail, which is complete on its own. */
export function explainFallback(f: Finding): string {
  return f.detail;
}

/** A copy of every chunk, so the finished text can be cached after it streamed. */
export function teeText(stream: ReadableStream<string>, onDone: (text: string) => void): ReadableStream<string> {
  let text = '';
  const reader = stream.getReader();
  return new ReadableStream<string>({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        onDone(text);
        controller.close();
        return;
      }
      text += value;
      controller.enqueue(value);
    },
    cancel() {
      void reader.cancel().catch(() => undefined);
    },
  });
}

export async function explainFinding(
  env: AppEnv,
  cfctx: ExecutionCtx | null,
  report: ScanReport,
  f: Finding,
): Promise<{ stream: ReadableStream<string>; cached: boolean; generated: boolean; fallback: string }> {
  const key = explainKey(report, f.id);
  const hit = env.CACHE ? ((await env.CACHE.get(key, 'json').catch(() => null)) as { text?: string } | null) : null;
  if (hit?.text) return { stream: once(hit.text), cached: true, generated: true, fallback: hit.text };
  const fallback = explainFallback(f);
  if (!env.AI) return { stream: once(fallback), cached: false, generated: false, fallback };
  const out = await streamText(env.AI, env.AI_GATEWAY_ID, explainPrompt(report, f), 260, { label: 'explain' });
  if (!out) return { stream: once(fallback), cached: false, generated: false, fallback };
  const stream = teeText(out.stream, (text) => {
    const clean = text.replace(/\u2014/g, ', ').trim();
    if (clean.length > 40 && env.CACHE) afterResponse(cfctx, env.CACHE.put(key, JSON.stringify({ text: clean }), { expirationTtl: 900 }));
  });
  return { stream, cached: false, generated: true, fallback };
}
