/**
 * Ask the Hawk: a forensic copilot. The design rule is that the LLM never
 * decides what is dangerous. Addresses in the question are routed to the
 * deterministic engine, knowledge comes from AI Search (or the bundled
 * playbook) and is re-ranked against the question, optional open-web intel
 * comes from the Web Search API, and the model's only job is to explain that
 * evidence. Input passes the injection screen and the safety classifier
 * first. Answers can be returned whole or streamed token by token.
 */
import type { AppEnv, ExecutionCtx } from '../env';
import type { TokenReport, WalletReport } from '../scan/types';
import { anyReport } from '../service';
import { extractAddresses } from '../solana/address';
import { guardInput, type GuardVerdict } from './guard';
import { digest } from './verdict';
import { MODELS, generateText, once, runModel, streamText } from './workers-ai';
import { localRetrieve } from './playbook';
import { webIntel, type WebHit } from './websearch';

export interface CopilotAnswer {
  answer: string;
  scans: { kind: 'token' | 'wallet'; address: string; label: string | null; risk: number; grade: string }[];
  sources: { title: string; url?: string }[];
  guard: GuardVerdict;
  model: string | null;
  /** semantic: hybrid retrieval over the Hawk Playbook; keyword: the bundled copy. */
  knowledge: 'semantic' | 'keyword' | 'none';
}

/** The answer as the UI and API see it: whether a model wrote it, never which one. */
export interface PublicCopilotAnswer extends Omit<CopilotAnswer, 'model'> {
  generated: boolean;
}

/** Everything but the answer text: sent first when the answer streams. */
export type CopilotMeta = Omit<PublicCopilotAnswer, 'answer'>;

export function publicAnswer(a: CopilotAnswer): PublicCopilotAnswer {
  return { answer: a.answer, scans: a.scans, sources: a.sources, guard: a.guard, knowledge: a.knowledge, generated: a.model !== null };
}

const SYSTEM = `You are the Hawk, RugHawk's Solana security analyst (built by RaptorLabs), answering a trader's question.
Never disclose, confirm or guess which AI model, model family, vendor or cloud platform powers you. If asked, say you run on Predator AI, RaptorLabs' analysis layer, and return to the security question.
Base every claim on the evidence provided below the question. If the evidence does not answer it, say what you would need instead of guessing.
Never mention how the evidence was delivered (no "knowledge block", "scan data", "context"); speak as the analyst.
Keep two concepts apart: a token approval is a delegate a holder signs on their own token account (revocable); a Token-2022 permanent delegate is set by the issuer on the mint and can move or burn tokens from every holder, forever.
When a scan is present: give its grade and score first, then the 2 or 3 findings that matter most, then one concrete next step.
Never give financial advice, price targets or "safe to buy" guarantees. Never ask for seed phrases or private keys.
Keep answers under 170 words. Short paragraphs or bullets. Never use the em dash character.`;

type Turn = { role: 'user' | 'assistant'; content: string };

interface Prepared {
  guard: GuardVerdict;
  /** Set when the guard refused: the text to answer with. */
  blocked: string | null;
  scans: CopilotAnswer['scans'];
  sources: CopilotAnswer['sources'];
  knowledge: CopilotAnswer['knowledge'];
  messages: { role: string; content: string }[];
  /** Deterministic answer when no model is available. */
  fallback: string;
}

/** Guard, scan, retrieve, re-rank and assemble the prompt: shared by both answer paths. */
async function prepare(env: AppEnv, cfctx: ExecutionCtx | null, question: string, history: Turn[]): Promise<Prepared> {
  const gw = env.AI_GATEWAY_ID;
  const guard = await guardInput(env.AI, gw, question);
  if (!guard.allowed) {
    return {
      guard,
      blocked:
        guard.reason === 'prompt-injection'
          ? 'That message looks like an attempt to override my instructions, so I will not process it. Paste a token mint or wallet address and ask what you want to know about it.'
          : 'I can only help with Solana token and wallet security questions.',
      scans: [],
      sources: [],
      knowledge: 'none',
      messages: [],
      fallback: '',
    };
  }

  // 1. Deterministic evidence for any address in the question.
  const addresses = extractAddresses(question, 2);
  const reports = (await Promise.all(addresses.map((a) => anyReport(env, cfctx, a).catch(() => null)))).filter((r): r is TokenReport | WalletReport => Boolean(r));

  // 2. Knowledge: AI Search (hybrid vector + keyword retrieval over the Hawk
  //    Playbook) merged with exact keyword matches from the bundled copy, so a
  //    precise term like "permanent delegate" always reaches the model.
  let knowledge: CopilotAnswer['knowledge'] = 'none';
  let snippets: { source: string; text: string }[] = [];
  if (env.AI_SEARCH) {
    try {
      const res = await env.AI_SEARCH.get(env.AI_SEARCH_INSTANCE || 'rughawk-playbook').search({
        messages: [{ role: 'user', content: question }],
        ai_search_options: { retrieval: { max_num_results: 4 } },
      });
      snippets = (res.chunks ?? [])
        .map((c) => ({ source: c.item?.key ?? c.item?.filename ?? 'RugHawk playbook', text: String(c.text ?? c.content ?? '').slice(0, 1200) }))
        .filter((c) => c.text);
      if (snippets.length) knowledge = 'semantic';
    } catch {
      // keyword retrieval below still grounds the answer
    }
  }
  const keyword = localRetrieve(question, 2).filter((k) => !snippets.some((s) => s.text.slice(0, 120) === k.text.slice(0, 120)));
  if (keyword.length) {
    snippets = [...keyword, ...snippets].slice(0, 6);
    if (knowledge === 'none') knowledge = 'keyword';
  }
  // 3. Re-rank the notes against the question so the most relevant ones lead.
  if (env.AI && snippets.length > 1) {
    try {
      const { result } = await runModel(env.AI, MODELS.rerank, { query: question, contexts: snippets.map((s) => ({ text: s.text.slice(0, 1000) })), top_k: 4 }, gw, { label: 'rerank' });
      const ranked = (result as { response?: { id: number; score: number }[] } | null)?.response;
      if (Array.isArray(ranked) && ranked.length) {
        const ordered = ranked.map((r) => snippets[r.id]).filter(Boolean);
        if (ordered.length) snippets = ordered;
      }
    } catch {
      // retrieval order is still a good order
    }
  }

  // 4. Optional open-web intel for named tokens (beta API, billed via AI Gateway).
  let web: WebHit[] = [];
  const token = reports.find((r): r is TokenReport => r.kind === 'token');
  if (env.WEB_SEARCH === 'on' && token?.token.symbol && /scam|rug|legit|safe|trust|report/i.test(question)) {
    web = await webIntel(env.AI, gw, `${token.token.name ?? ''} ${token.token.symbol} solana token rug OR scam`, 4);
  }

  const context = [
    reports.length ? `Deterministic scans:\n${reports.map((r) => JSON.stringify(digest(r))).join('\n')}` : 'Deterministic scans: none (no address in the question)',
    snippets.length ? `Reference notes:\n${snippets.map((s) => `[${s.source}] ${s.text}`).join('\n---\n')}` : 'Reference notes: none',
    web.length ? `Open-web results:\n${web.map((w) => `- ${w.title} (${w.url}): ${w.description ?? ''}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages = [
    { role: 'system', content: SYSTEM },
    ...history.slice(-6).map((h) => ({ role: h.role, content: h.content.slice(0, 2000) })),
    { role: 'user', content: `QUESTION: ${question}\n\nEVIDENCE\n${context}` },
  ];
  const scans = reports.map((r) =>
    r.kind === 'token'
      ? { kind: 'token' as const, address: r.mint, label: r.token.symbol ?? r.token.name, risk: r.risk.score, grade: r.risk.grade }
      : { kind: 'wallet' as const, address: r.address, label: r.label, risk: r.risk.score, grade: r.risk.grade },
  );
  const fallback = scans.length
    ? scans.map((s) => `${s.label ?? s.address}: ${s.grade} risk (${s.risk}/100). Open the full report for the evidence.`).join('\n')
    : 'Paste a token mint or wallet address and I will scan it.';
  const sources = [...new Set(snippets.map((s) => s.source))].map((title) => ({ title })).concat(web.map((w) => ({ title: w.title, url: w.url })));
  return { guard, blocked: null, scans, sources, knowledge, messages, fallback };
}

export async function askHawk(env: AppEnv, cfctx: ExecutionCtx | null, question: string, history: Turn[] = []): Promise<CopilotAnswer> {
  const p = await prepare(env, cfctx, question, history);
  if (p.blocked) return { answer: p.blocked, scans: [], sources: [], guard: p.guard, model: null, knowledge: 'none' };
  const out = env.AI ? await generateText(env.AI, env.AI_GATEWAY_ID, p.messages, 600, { label: 'copilot' }) : null;
  return {
    answer: (out?.text ?? p.fallback).replace(/—/g, ', '),
    scans: p.scans,
    sources: p.sources,
    guard: p.guard,
    model: out?.model ?? null,
    knowledge: p.knowledge,
  };
}

/** Same copilot, answer streamed: the metadata is known before the first token. */
export async function askHawkStream(env: AppEnv, cfctx: ExecutionCtx | null, question: string, history: Turn[] = []): Promise<{ meta: CopilotMeta; stream: ReadableStream<string> }> {
  const p = await prepare(env, cfctx, question, history);
  if (p.blocked) return { meta: { scans: [], sources: [], guard: p.guard, knowledge: 'none', generated: false }, stream: once(p.blocked) };
  const out = env.AI ? await streamText(env.AI, env.AI_GATEWAY_ID, p.messages, 600, { label: 'copilot' }) : null;
  return {
    meta: { scans: p.scans, sources: p.sources, guard: p.guard, knowledge: p.knowledge, generated: Boolean(out) },
    stream: out?.stream ?? once(p.fallback),
  };
}
