/**
 * Market pulse: what the last 24 hours of flagged launches have in common.
 * The counts come from the deterministic engine's own findings (stored with
 * every scan); the model only phrases them. Cached for ten minutes so the
 * home page costs one generation per ten minutes, not one per visitor.
 */
import type { AppEnv } from '../env';
import { feed, stats as totals } from '../db';
import { generateStructured } from './workers-ai';
import { fallbackPulse, pulseStats, type Pulse, type PulseStats } from './pulse-stats';

export type { Pulse, PulseStats, PatternKey } from './pulse-stats';
export { PATTERN_LABELS, PULSE_PATTERNS, fallbackPulse, pulseStats } from './pulse-stats';

const SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'Max 9 words naming the dominant pattern of the window, for example "Fresh wallets launching, deployers already exiting". Never starts with "Market pulse". Only numbers present in the stats.' },
    body: { type: 'string', description: 'Two sentences in plain English on what the flagged launches have in common, using only the counts and token names given. No totals, no praise of the system.' },
    watch: { type: 'string', description: 'One short imperative sentence tied to the most common pattern: the concrete thing to check on a new token before buying, for example the launch block buyers or whether the deployer still holds its bag.' },
  },
  required: ['headline', 'body', 'watch'],
};

const SYSTEM = `You are the Hawk, RugHawk's Solana forensic analyst, writing the market pulse shown on the home page.
You receive counts computed by the deterministic engine over the tokens it flagged HIGH or CRITICAL in the last 24 hours (patterns: how many flagged tokens showed each behaviour) with the names of the three most recent ones.
Write for a trader deciding whether to buy a fresh launch today: name the behaviour that dominates, say how many of the flagged tokens showed it, mention a recent token by name only as an example. Use only numbers present in the input. Never invent tokens, events or causes. No financial advice. Never use the em dash character.`;

export async function marketPulse(env: AppEnv): Promise<Pulse> {
  const key = 'pulse:v2';
  const hit = env.CACHE ? ((await env.CACHE.get(key, 'json').catch(() => null)) as Pulse | null) : null;
  if (hit) return hit;
  const [rows, t] = await Promise.all([feed(env.DB, { grade: 'risky', limit: 50 }), totals(env.DB)]);
  const stats: PulseStats = { ...pulseStats(rows), totals: t };
  let text = fallbackPulse(stats);
  let generated = false;
  if (env.AI && stats.flagged > 0) {
    const out = await generateStructured<{ headline: string; body: string; watch: string }>(env.AI, env.AI_GATEWAY_ID, {
      system: SYSTEM,
      user: `STATS (last 24 hours):\n${JSON.stringify({ ...stats, totals: undefined })}`,
      schema: SCHEMA,
      maxTokens: 300,
      gateway: { cacheTtl: 600, label: 'pulse' },
    });
    if (out) {
      const clean = (v: unknown) => String(v ?? '').replace(/—/g, ', ').trim();
      const headline = clean(out.data.headline).slice(0, 120);
      const body = clean(out.data.body).slice(0, 500);
      if (headline && body) {
        text = { headline, body, watch: clean(out.data.watch).slice(0, 200) };
        generated = true;
      }
    }
  }
  const pulse: Pulse = { ...text, stats, generated, at: Date.now() };
  await env.CACHE?.put(key, JSON.stringify(pulse), { expirationTtl: 600 }).catch(() => undefined);
  return pulse;
}
