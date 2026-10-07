/**
 * Guard in front of the copilot.
 *
 *   1. Injection check: pattern-based screening for instruction-override and
 *      jailbreak attempts. (Prompt Guard 2 is not callable from Workers AI on
 *      this account; Cloudflare exposes it as the P1 category of AI Gateway
 *      Guardrails, which can be switched on for the gateway in the dashboard.)
 *   2. Llama Guard 3 (8B) on Workers AI classifies the message against the
 *      MLCommons hazard categories.
 *
 * The copilot architecture is the real defence: the LLM never decides what is
 * dangerous and never triggers actions, it only explains deterministic scans.
 * Llama Guard fails open with a warning so an unavailable classifier does not
 * block every honest question.
 */
import type { AiBinding } from '../env';
import { MODELS, extractText, runModel } from './workers-ai';

export interface GuardVerdict {
  allowed: boolean;
  /** 0..1 from the pattern check; null when nothing was evaluated. */
  injectionScore: number | null;
  unsafeCategories: string[];
  reason?: string;
}

const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|your|system)\b[^.\n]{0,30}\b(instructions?|prompts?|rules?|guidelines?|messages?)\b/i,
  /\b(reveal|print|show|repeat|leak|output)\b[^.\n]{0,30}\b(system|hidden|initial|developer)\b[^.\n]{0,15}\b(prompt|instructions?|message)\b/i,
  /\byou are now\b|\bact as (an? )?(unrestricted|unfiltered|jailbroken)\b|\b(DAN|developer mode|jailbreak|god mode)\b/i,
  /\bnew (system )?instructions?\s*:/i,
  /<\s*\/?\s*(system|assistant|instructions?)\s*>/i,
  /\[\s*(system|INST)\s*\]/i,
];

export function injectionScore(text: string): number {
  const hits = INJECTION_PATTERNS.filter((re) => re.test(text)).length;
  return hits === 0 ? 0 : Math.min(1, 0.6 + hits * 0.2);
}

export async function guardInput(ai: AiBinding | undefined, gatewayId: string | undefined, text: string): Promise<GuardVerdict> {
  const score = injectionScore(text);
  if (score >= 0.8) return { allowed: false, injectionScore: score, unsafeCategories: [], reason: 'prompt-injection' };
  if (!ai) return { allowed: true, injectionScore: score, unsafeCategories: [] };

  const safety = await runModel(ai, MODELS.safety, { messages: [{ role: 'user', content: text }] }, gatewayId, { label: 'guard-safety' }).catch(() => null);
  // Llama Guard answers "safe" or "unsafe\nS<n>[,S<n>]".
  const verdict = (extractText(safety?.result) ?? '').trim().toLowerCase();
  if (/^unsafe/.test(verdict)) {
    return { allowed: false, injectionScore: score, unsafeCategories: verdict.match(/s\d{1,2}/g) ?? [], reason: 'unsafe-content' };
  }
  return { allowed: true, injectionScore: score, unsafeCategories: [] };
}
