/**
 * Two-layer guard in front of the copilot, both on Workers AI:
 *   Prompt Guard 2 (86M) scores prompt injection and jailbreak attempts;
 *   Llama Guard 3 (8B) classifies content against the MLCommons hazard list.
 * A security product's own AI must not be the soft target. Both fail open
 * with a logged warning: an unavailable classifier must not block every
 * honest question, and the copilot never executes anything a prompt asks.
 */
import type { AiBinding } from '../env';
import { MODELS, extractText, runModel } from './workers-ai';

export interface GuardVerdict {
  allowed: boolean;
  injectionScore: number | null;
  unsafeCategories: string[];
  reason?: string;
}

export async function guardInput(ai: AiBinding | undefined, gatewayId: string | undefined, text: string): Promise<GuardVerdict> {
  if (!ai) return { allowed: true, injectionScore: null, unsafeCategories: [] };
  const [injection, safety] = await Promise.all([
    runModel(ai, MODELS.injection, { text }, gatewayId, { label: 'guard-injection' }).catch(() => null),
    runModel(ai, MODELS.safety, { messages: [{ role: 'user', content: text }] }, gatewayId, { label: 'guard-safety' }).catch(() => null),
  ]);

  const injectionScore = readInjectionScore(injection?.result);
  const safetyText = (extractText(safety?.result) ?? '').toLowerCase();
  const safetyObj = (safety?.result as { response?: { safe?: boolean; categories?: string[] } } | undefined)?.response;
  const unsafe = safetyObj && typeof safetyObj === 'object' ? safetyObj.safe === false : /^\s*unsafe/.test(safetyText);
  const categories =
    (safetyObj && typeof safetyObj === 'object' && Array.isArray(safetyObj.categories) ? safetyObj.categories : safetyText.match(/s\d{1,2}/gi)) ?? [];

  if (injectionScore !== null && injectionScore >= 0.9) {
    return { allowed: false, injectionScore, unsafeCategories: categories, reason: 'prompt-injection' };
  }
  if (unsafe) return { allowed: false, injectionScore, unsafeCategories: categories, reason: 'unsafe-content' };
  return { allowed: true, injectionScore, unsafeCategories: [] };
}

/** Prompt Guard returns label/score pairs; normalise to P(malicious). */
function readInjectionScore(result: unknown): number | null {
  if (!result) return null;
  const arr = Array.isArray(result) ? result : (result as { result?: unknown }).result ?? (result as { response?: unknown }).response;
  const list = Array.isArray(arr) ? (arr as { label?: string; score?: number }[]) : [];
  const bad = list.find((x) => /malicious|injection|jailbreak|label_1/i.test(String(x.label)));
  if (bad && typeof bad.score === 'number') return bad.score;
  const benign = list.find((x) => /benign|label_0/i.test(String(x.label)));
  if (benign && typeof benign.score === 'number') return 1 - benign.score;
  return null;
}
