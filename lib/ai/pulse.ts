/**
 * Market pulse: what the last 24 hours of flagged launches have in common.
 * The counts come from the deterministic engine's own findings (stored with
 * every scan); the model only phrases them. Cached for ten minutes so the
 * home page costs one generation per ten minutes, not one per visitor.
 */
import type { AppEnv } from '../env';
import { feed, stats as totals } from '../db';
import { generateStructured } from './workers-ai';
import { PATTERN_LABELS, fallbackPulse, pulseStats, type PatternKey, type Pulse, type PulseStats } from './pulse-stats';

export type { Pulse, PulseStats, PatternKey } from './pulse-stats';
export { PATTERN_LABELS, PULSE_PATTERNS, fallbackPulse, pulseStats } from './pulse-stats';

const SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'Max 9 words naming the dominant behaviour in plain words, for example "Fresh wallets launching, deployers already exiting". Only numbers present in the input.' },
    body: { type: 'string', description: 'Two sentences in plain English on what the flagged launches have in common, using only the counts and token names given. No totals, no praise of the system.' },
    watch: { type: 'string', description: 'One short imperative sentence tied to the most common pattern: the concrete thing to check on a new token before buying, for example the launch block buyers or whether the deployer still holds its bag.' },
  },
  required: ['headline', 'body', 'watch'],
};

const SYSTEM = `You are the Hawk, RugHawk's Solana forensic analyst, writing the market pulse shown on the home page.
You receive counts computed by the deterministic engine over the tokens it flagged HIGH or CRITICAL in the last 24 hours: how many of those tokens showed each behaviour, the launchpads, and the most recent ones by name.
Write for a trader deciding whether to buy a fresh launch today. Name the behaviour that dominates in plain words (as given), say how many of the flagged tokens showed it, and mention one recent token by name as an example. Write complete sentences; never list the counts mechanically, never repeat the input labels verbatim as if they were code, never start with a title or the words "Market pulse". Use only numbers present in the input. Never invent tokens, events or causes. No financial advice. Never use the em dash character.`;

/** The counts as the model should read them: labels, not keys; the window, not the all-time totals. */
export function pulseBrief(s: Omit<PulseStats, 'totals'>): Record<string, unknown> {
  const behaviours = Object.fromEntries(
    (Object.entries(s.patterns) as [PatternKey, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => [PATTERN_LABELS[k], n]),
  );
  return {
    flaggedTokens: s.flagged,
    critical: s.critical,
    high: s.high,
    behavioursSeenAmongFlaggedTokens: behaviours,
    launchpads: s.launchpads,
    mostRecent: s.latest.map((l) => `${l.symbol ? `$${l.symbol}` : 'unnamed token'} (${l.grade} ${l.risk}/100, ${l.minutesAgo} minutes ago)`),
  };
}

/** Strip the kicker the model keeps adding, em dashes and stray whitespace. */
export function tidy(v: unknown): string {
  return String(v ?? '')
    .replace(/\u2014/g, ', ')
    .replace(/^\s*(market\s*pulse|pulse)\s*[:.-]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function marketPulse(env: AppEnv): Promise<Pulse> {
  const key = 'pulse:v3';
  const hit = env.CACHE ? ((await env.CACHE.get(key, 'json').catch(() => null)) as Pulse | null) : null;
  if (hit) return hit;
  const [rows, t] = await Promise.all([feed(env.DB, { grade: 'risky', limit: 50 }), totals(env.DB)]);
  const stats: PulseStats = { ...pulseStats(rows), totals: t };
  let text = fallbackPulse(stats);
  let generated = false;
  if (env.AI && stats.flagged > 0) {
    const out = await generateStructured<{ headline: string; body: string; watch: string }>(env.AI, env.AI_GATEWAY_ID, {
      system: SYSTEM,
      user: `LAST 24 HOURS:\n${JSON.stringify(pulseBrief(stats))}`,
      schema: SCHEMA,
      maxTokens: 300,
      temperature: 0.3,
      gateway: { cacheTtl: 600, label: 'pulse' },
    });
    if (out) {
      const headline = tidy(out.data.headline).slice(0, 120);
      const body = tidy(out.data.body).slice(0, 500);
      const watch = tidy(out.data.watch).slice(0, 200);
      if (headline.length > 8 && body.length > 20) {
        text = { headline, body, watch: watch.length > 15 ? watch : text.watch };
        generated = true;
      }
    }
  }
  const pulse: Pulse = { ...text, stats, generated, at: Date.now() };
  await env.CACHE?.put(key, JSON.stringify(pulse), { expirationTtl: 600 }).catch(() => undefined);
  return pulse;
}
