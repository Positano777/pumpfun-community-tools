/**
 * The warning post. Every shared report is distribution, and the fastest
 * way to get one shared is to write it for the trader: a post for X under
 * the character limit and a longer note for a Telegram group, both built
 * only from the scan's findings. The model phrases; the engine supplied
 * every fact. Cached per (address, score) so the whole community shares
 * the same wording.
 */
import type { AppEnv } from '../env';
import type { ScanReport } from '../scan/types';
import { digest } from './verdict';
import { generateStructured } from './workers-ai';

export interface SharePost {
  x: string;
  telegram: string;
}

export const X_MAX = 240;
export const TELEGRAM_MAX = 650;

const SCHEMA = {
  type: 'object',
  properties: {
    x: { type: 'string', description: `A post for X under ${X_MAX} characters: the most dangerous behaviour first, then grade and score, ending with "Verify it yourself:" (the link is added by the app).` },
    telegram: { type: 'string', description: `A message for a Telegram group under ${TELEGRAM_MAX} characters: one sentence of context, then up to three findings as lines starting with "- ", then one line on what to do.` },
  },
  required: ['x', 'telegram'],
};

const SYSTEM = `You write a warning that a Solana trader can paste into X or a Telegram group after reading a RugHawk scan.
Facts only, taken from the scan you are given; never invent events, numbers or names. Name the single most dangerous behaviour first, in plain words ("deployer dumped 100% of its bag 6 seconds after launch"), then the grade and score as "RugHawk grade CRITICAL 84/100".
Use the $TICKER cashtag once when a ticker exists. One warning sign emoji at the start is allowed; no other emojis, no hashtags, no hype, no insults, no accusations of crime: state what the chain shows.
A LOW grade is not an endorsement: say what was checked and that a low score is not a guarantee.
End the X post with "Verify it yourself:" because the app appends the report link. Never use the em dash character.`;

/** Cut at a word boundary inside the limit, never mid-word. */
export function clampText(text: string, max: number): string {
  const t = text.replace(/\u2014/g, ', ').replace(/[ \t]+/g, ' ').trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('\n'), head.lastIndexOf(' '));
  return (cut > max * 0.5 ? head.slice(0, cut) : head).trim();
}

/** The post without a model: grade, score and the top findings, in the same shape. */
export function fallbackPost(report: ScanReport): SharePost {
  const label = report.kind === 'token' ? `${report.token.symbol ? `$${report.token.symbol}` : report.token.name ?? 'this token'}` : `wallet ${report.address.slice(0, 4)}...${report.address.slice(-4)}`;
  const flags = report.findings.filter((f) => f.weight > 0).slice(0, 3).map((f) => f.title);
  const grade = `RugHawk grade ${report.risk.grade} ${report.risk.score}/100`;
  const lead = flags[0] ? `${flags[0]}.` : 'No structural red flags found; a low score is not a guarantee.';
  const warn = report.risk.score >= 45 ? '⚠️ ' : '';
  return {
    x: clampText(`${warn}${label}: ${lead} ${grade}. Verify it yourself:`, X_MAX),
    telegram: clampText(`${warn}RugHawk scan of ${label}: ${grade}.\n${flags.length ? flags.map((f) => `- ${f}`).join('\n') : '- No structural red flags found'}\nRead the full evidence before you buy; a low score is not a guarantee.`, TELEGRAM_MAX),
  };
}

/** The model's post if it is usable, else the fallback. */
export function acceptPost(raw: unknown, fallback: SharePost): { post: SharePost; generated: boolean } {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const x = typeof r.x === 'string' ? clampText(r.x, X_MAX) : '';
  const telegram = typeof r.telegram === 'string' ? clampText(r.telegram, TELEGRAM_MAX) : '';
  if (x.length < 30 || telegram.length < 40) return { post: fallback, generated: false };
  return { post: { x: /verify it yourself:?$/i.test(x) ? x : `${clampText(x, X_MAX - 21)} Verify it yourself:`, telegram }, generated: true };
}

export function shareKey(report: ScanReport): string {
  const address = report.kind === 'token' ? report.mint : report.address;
  return `share:v1:${report.kind}:${address}:${report.risk.score}`;
}

export async function sharePost(env: AppEnv, report: ScanReport): Promise<{ post: SharePost; generated: boolean; cached: boolean }> {
  const key = shareKey(report);
  const hit = env.CACHE ? ((await env.CACHE.get(key, 'json').catch(() => null)) as { post: SharePost; generated: boolean } | null) : null;
  if (hit?.post) return { ...hit, cached: true };
  const fallback = fallbackPost(report);
  if (!env.AI) return { post: fallback, generated: false, cached: false };
  const subject = report.kind === 'token' ? `token ${report.token.symbol ?? report.mint}` : `${report.accountType} ${report.address}`;
  const out = await generateStructured<Record<string, unknown>>(env.AI, env.AI_GATEWAY_ID, {
    system: SYSTEM,
    user: `Write the warning for this RugHawk scan of ${subject}.\nSCAN:\n${JSON.stringify(digest(report))}`,
    schema: SCHEMA,
    maxTokens: 500,
    temperature: 0.4,
    gateway: { cacheTtl: 900, label: 'share' },
  });
  const result = acceptPost(out?.data, fallback);
  if (result.generated) await env.CACHE?.put(key, JSON.stringify(result), { expirationTtl: 900 }).catch(() => undefined);
  return { ...result, cached: false };
}
