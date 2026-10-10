/**
 * The Shield briefing: what the approvals, seizable holdings and empty
 * accounts in a wallet mean for its owner, in three sentences and up to
 * three actions. The Shield report is deterministic (lib/scan/shield.ts);
 * the model only phrases it. Cached per wallet state, so re-opening Shield
 * after a revoke produces a fresh briefing and nothing else does.
 */
import type { AppEnv } from '../env';
import type { ShieldReport } from '../scan/shield';
import { TOKEN_2022_PROGRAM } from '../solana/known';
import { generateStructured } from './workers-ai';

export interface ShieldBrief {
  headline: string;
  summary: string;
  actions: string[];
}

const SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'Max 10 words: the state of this wallet in plain words, no numbers that are not in the input.' },
    summary: { type: 'string', description: 'Two or three sentences on what the approvals, seizable holdings and empty accounts mean for the owner.' },
    actions: { type: 'array', items: { type: 'string' }, maxItems: 3, description: 'Up to three actions, each starting with a verb (Revoke, Reclaim, Move, Keep), tied to the counts given.' },
  },
  required: ['headline', 'summary', 'actions'],
};

const SYSTEM = `You are the Hawk, RugHawk's wallet security analyst, briefing a wallet owner on their Shield report.
Facts: a live approval is a delegate the owner signed on one of their token accounts; it can move up to the allowed amount without asking again, and Revoke cancels it. A Token-2022 permanent delegate is set by the token's issuer on the mint; it can take or burn that token from every holder at any time and the owner cannot revoke it, so the only fix is to sell or move out of that token. An empty token account holds a refundable SOL deposit (rent) that closing returns. Frozen accounts cannot be closed.
Use only the counts and amounts in the input. Speak to the owner as "you". No financial advice, no price talk. Never use the em dash character.`;

const short = (a: string | null) => (a ? `${a.slice(0, 4)}...${a.slice(-4)}` : null);

/** The report as the model reads it: counts, amounts and the first few items of each list. */
export function shieldDigest(r: ShieldReport): Record<string, unknown> {
  return {
    tokenAccounts: r.accounts.length,
    liveApprovals: r.delegated.length,
    approvals: r.delegated.slice(0, 6).map((a) => ({
      mint: short(a.mint),
      delegate: short(a.delegate),
      allowedToMove: a.delegatedUi,
      balance: a.uiAmount,
      program: a.programId === TOKEN_2022_PROGRAM ? 'token-2022' : 'spl-token',
    })),
    seizableHoldings: r.permanentDelegateExposure.length,
    seizable: r.permanentDelegateExposure.slice(0, 6).map((a) => ({ mint: short(a.mint), balance: a.uiAmount })),
    frozenAccounts: r.frozen.length,
    emptyAccounts: r.closable.length,
    reclaimableSol: Math.round(r.reclaimableSol * 10_000) / 10_000,
  };
}

/** A briefing without a model: the same facts, phrased by rules. */
export function fallbackBrief(r: ShieldReport): ShieldBrief {
  const approvals = r.delegated.length;
  const seizable = r.permanentDelegateExposure.length;
  const empty = r.closable.length;
  const sol = r.reclaimableSol.toFixed(4);
  const actions: string[] = [];
  if (approvals) actions.push(`Revoke the ${approvals === 1 ? 'live approval' : `${approvals} live approvals`} so no delegate can move your tokens again.`);
  if (seizable) actions.push(`Move out of the ${seizable === 1 ? 'token' : `${seizable} tokens`} whose issuer keeps a permanent delegate; you cannot revoke that power.`);
  if (empty) actions.push(`Reclaim ${sol} SOL by closing ${empty === 1 ? 'the empty token account' : `${empty} empty token accounts`}.`);
  if (!actions.length) actions.push('Keep signing only what you understand; nothing here needs fixing today.');
  const headline = approvals || seizable ? `${approvals ? `${approvals} open ${approvals === 1 ? 'door' : 'doors'}` : 'No approvals'}${seizable ? `, ${seizable} seizable ${seizable === 1 ? 'holding' : 'holdings'}` : ''}` : empty ? `Clean wallet, ${sol} SOL to reclaim` : 'Clean wallet, nothing to fix';
  const summary = [
    approvals ? `${approvals === 1 ? 'One delegate' : `${approvals} delegates`} can still move your tokens without a new signature.` : 'No delegate can move your tokens without a new signature.',
    seizable ? `${seizable === 1 ? 'One holding' : `${seizable} holdings`} can be taken by the token issuer at any time.` : '',
    empty ? `${empty === 1 ? 'One empty account holds' : `${empty} empty accounts hold`} ${sol} SOL of refundable rent.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return { headline, summary, actions };
}

const clean = (s: unknown) => String(s ?? '').replace(/\u2014/g, ', ').replace(/\s+/g, ' ').trim();

export function acceptBrief(raw: unknown, fallback: ShieldBrief): { brief: ShieldBrief; generated: boolean } {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const headline = clean(r.headline).slice(0, 120);
  const summary = clean(r.summary).slice(0, 700);
  const actions = (Array.isArray(r.actions) ? r.actions : []).map(clean).filter(Boolean).slice(0, 3).map((a) => a.slice(0, 200));
  if (headline.length < 6 || summary.length < 20) return { brief: fallback, generated: false };
  return { brief: { headline, summary, actions: actions.length ? actions : fallback.actions }, generated: true };
}

/** Changes with the wallet state the briefing describes. */
export async function briefKey(r: ShieldReport): Promise<string> {
  const state = [r.owner, r.accounts.length, r.delegated.map((a) => a.address).join(','), r.permanentDelegateExposure.map((a) => a.address).join(','), r.closable.length, Math.round(r.reclaimableSol * 1e6)].join('|');
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state));
  return `shield:brief:v1:${[...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)}`;
}

export async function shieldBrief(env: AppEnv, report: ShieldReport): Promise<{ brief: ShieldBrief; generated: boolean; cached: boolean }> {
  const key = await briefKey(report);
  const hit = env.CACHE ? ((await env.CACHE.get(key, 'json').catch(() => null)) as { brief: ShieldBrief; generated: boolean } | null) : null;
  if (hit?.brief) return { ...hit, cached: true };
  const fallback = fallbackBrief(report);
  if (!env.AI) return { brief: fallback, generated: false, cached: false };
  const out = await generateStructured<Record<string, unknown>>(env.AI, env.AI_GATEWAY_ID, {
    system: SYSTEM,
    user: `Brief the owner of this wallet.\nSHIELD REPORT:\n${JSON.stringify(shieldDigest(report))}`,
    schema: SCHEMA,
    maxTokens: 400,
    temperature: 0.3,
    gateway: { cacheTtl: 600, label: 'shield-brief' },
  });
  const result = acceptBrief(out?.data, fallback);
  if (result.generated) await env.CACHE?.put(key, JSON.stringify(result), { expirationTtl: 600 }).catch(() => undefined);
  return { ...result, cached: false };
}
