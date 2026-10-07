/**
 * Ask the Hawk: a forensic copilot. The design rule is that the LLM never
 * decides what is dangerous. Addresses in the question are routed to the
 * deterministic engine, knowledge comes from AI Search (or the bundled
 * playbook), optional open-web intel from the Web Search API, and the model's
 * only job is to explain that evidence. Input passes Prompt Guard and Llama
 * Guard first.
 */
import type { AppEnv, ExecutionCtx } from '../env';
import type { TokenReport, WalletReport } from '../scan/types';
import { anyReport } from '../service';
import { extractAddresses } from '../solana/address';
import { guardInput, type GuardVerdict } from './guard';
import { digest } from './verdict';
import { generateText } from './workers-ai';
import { localRetrieve } from './playbook';
import { webIntel, type WebHit } from './websearch';

export interface CopilotAnswer {
  answer: string;
  scans: { kind: 'token' | 'wallet'; address: string; label: string | null; risk: number; grade: string }[];
  sources: { title: string; url?: string }[];
  guard: GuardVerdict;
  model: string | null;
  knowledge: 'ai-search' | 'playbook' | 'none';
}

const SYSTEM = `You are RugHawk, a Solana security analyst answering a user's question.
Ground every claim in the SCANS, KNOWLEDGE and WEB blocks you are given. If they do not contain the answer, say what you would need.
When a scan is present: state its grade and score first, then the 2 or 3 findings that matter most, then one concrete next step.
Never give financial advice, price targets or "safe to buy" guarantees. Never ask for seed phrases or private keys.
Keep answers under 180 words. Use short paragraphs or bullets. Never use the em dash character.`;

export async function askHawk(env: AppEnv, cfctx: ExecutionCtx | null, question: string, history: { role: 'user' | 'assistant'; content: string }[] = []): Promise<CopilotAnswer> {
  const gw = env.AI_GATEWAY_ID;
  const guard = await guardInput(env.AI, gw, question);
  if (!guard.allowed) {
    return {
      answer:
        guard.reason === 'prompt-injection'
          ? 'That message looks like an attempt to override my instructions, so I will not process it. Paste a token mint or wallet address and ask what you want to know about it.'
          : 'I can only help with Solana token and wallet security questions.',
      scans: [],
      sources: [],
      guard,
      model: null,
      knowledge: 'none',
    };
  }

  // 1. Deterministic evidence for any address in the question.
  const addresses = extractAddresses(question, 2);
  const reports = (await Promise.all(addresses.map((a) => anyReport(env, cfctx, a).catch(() => null)))).filter((r): r is TokenReport | WalletReport => Boolean(r));

  // 2. Knowledge: AI Search when configured, bundled playbook otherwise.
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
      if (snippets.length) knowledge = 'ai-search';
    } catch {
      // fall back below
    }
  }
  if (!snippets.length) {
    snippets = localRetrieve(question, 3);
    if (snippets.length) knowledge = 'playbook';
  }

  // 3. Optional open-web intel for named tokens (beta API, billed via AI Gateway).
  let web: WebHit[] = [];
  const token = reports.find((r): r is TokenReport => r.kind === 'token');
  if (env.WEB_SEARCH === 'on' && token?.token.symbol && /scam|rug|legit|safe|trust|report/i.test(question)) {
    web = await webIntel(env.AI, gw, `${token.token.name ?? ''} ${token.token.symbol} solana token rug OR scam`, 4);
  }

  const context = [
    reports.length ? `SCANS:\n${reports.map((r) => JSON.stringify(digest(r))).join('\n')}` : 'SCANS: none (no address in the question)',
    snippets.length ? `KNOWLEDGE:\n${snippets.map((s) => `[${s.source}] ${s.text}`).join('\n---\n')}` : 'KNOWLEDGE: none',
    web.length ? `WEB:\n${web.map((w) => `- ${w.title} (${w.url}): ${w.description ?? ''}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages = [
    { role: 'system', content: SYSTEM },
    ...history.slice(-6).map((h) => ({ role: h.role, content: h.content.slice(0, 2000) })),
    { role: 'user', content: `${context}\n\nQUESTION: ${question}` },
  ];
  const out = env.AI ? await generateText(env.AI, gw, messages, 600, { label: 'copilot' }) : null;
  const scans = reports.map((r) =>
    r.kind === 'token'
      ? { kind: 'token' as const, address: r.mint, label: r.token.symbol ?? r.token.name, risk: r.risk.score, grade: r.risk.grade }
      : { kind: 'wallet' as const, address: r.address, label: r.label, risk: r.risk.score, grade: r.risk.grade },
  );
  const fallback = scans.length
    ? scans.map((s) => `${s.label ?? s.address}: ${s.grade} risk (${s.risk}/100). Open the full report for the evidence.`).join('\n')
    : 'Paste a token mint or wallet address and I will scan it.';
  return {
    answer: (out?.text ?? fallback).replace(/\u2014/g, ', '),
    scans,
    sources: [...new Set(snippets.map((s) => s.source))].map((title) => ({ title })).concat(web.map((w) => ({ title: w.title, url: w.url }))),
    guard,
    model: out?.model ?? null,
    knowledge,
  };
}
