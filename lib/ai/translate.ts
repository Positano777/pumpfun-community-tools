/**
 * Verdicts in the reader's language. The English verdict stays the source of
 * truth; each field is translated with a dedicated translation model and the
 * result is cached per (address, score, language) so a language switch costs
 * one round trip once.
 */
import type { AiBinding } from '../env';
import type { PublicAiVerdict } from '../scan/types';
import { MODELS, runModel } from './workers-ai';

export { LANGUAGES, isLanguage, type LanguageCode } from './languages';
import { LANGUAGES as TABLE, type LanguageCode as Code } from './languages';

async function translateText(ai: AiBinding, gatewayId: string | undefined, text: string, lang: Code): Promise<string> {
  if (!text.trim()) return text;
  // The model accepts language names; codes are the second attempt.
  for (const [source, target] of [
    ['english', TABLE[lang].name],
    ['en', lang],
  ]) {
    try {
      const { result } = await runModel(ai, MODELS.translate, { text, source_lang: source, target_lang: target }, gatewayId, { cacheTtl: 86_400, label: 'translate' });
      const out = (result as { translated_text?: unknown } | null)?.translated_text;
      if (typeof out === 'string' && out.trim()) return out.trim();
    } catch {
      // next form
    }
  }
  return text;
}

export async function translateVerdict(ai: AiBinding, gatewayId: string | undefined, v: PublicAiVerdict, lang: Code): Promise<PublicAiVerdict> {
  const t = (s: string) => translateText(ai, gatewayId, s, lang);
  const [headline, summary, topRisks, watch] = await Promise.all([t(v.headline), t(v.summary), Promise.all(v.topRisks.map(t)), Promise.all(v.watch.map(t))]);
  return { headline, summary, topRisks, watch, confidence: v.confidence };
}
