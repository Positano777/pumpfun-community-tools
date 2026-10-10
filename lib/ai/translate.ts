/**
 * Verdicts in the reader's language. The English verdict stays the source of
 * truth. Gemma 4 (140+ languages, structured output) translates the whole
 * verdict in one call so tickers, addresses and the crypto vocabulary stay
 * intact; m2m100 translates field by field when the model is unavailable.
 * The result is cached per (address, score, language) by the route, so a
 * language switch costs one round trip once.
 */
import type { AiBinding } from '../env';
import type { PublicAiVerdict } from '../scan/types';
import { MODELS, generateStructured, runModel } from './workers-ai';

export { LANGUAGES, isLanguage, type LanguageCode } from './languages';
import { LANGUAGES as TABLE, type LanguageCode as Code } from './languages';

const SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    summary: { type: 'string' },
    topRisks: { type: 'array', items: { type: 'string' } },
    watch: { type: 'array', items: { type: 'string' } },
  },
  required: ['headline', 'summary', 'topRisks', 'watch'],
};

const KEEP = 'RugHawk, pump.fun, PumpSwap, Raydium, Meteora, Jupiter, Streamflow, Jito, Token-2022, SPL';

export function translationSystem(language: string): string {
  return `You translate a Solana token security verdict from English into ${language} for a crypto trader who reads ${language} natively.
Translate every field. Keep the same number of items in each list and the same order.
Keep as written: token tickers, wallet addresses, numbers, percentages, durations, and the names ${KEEP}.
Use the terms a ${language}-speaking crypto trader uses for mint authority, freeze authority, permanent delegate, bonding curve, launch block, deployer, liquidity; keep the English term in parentheses the first time when no common equivalent exists.
Return only the translated JSON. Never use the em dash character.`;
}

const clean = (s: unknown) => String(s ?? '').replace(/\s*\u2014\s*/g, ', ').replace(/[ \t]+/g, ' ').trim();

/** The model's translation when it has every field; null otherwise. */
export function acceptTranslation(raw: unknown, source: PublicAiVerdict): PublicAiVerdict | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const headline = clean(v.headline);
  const summary = clean(v.summary);
  const topRisks = Array.isArray(v.topRisks) ? v.topRisks.map(clean).filter(Boolean) : [];
  const watch = Array.isArray(v.watch) ? v.watch.map(clean).filter(Boolean) : [];
  if (!headline || !summary) return null;
  if (topRisks.length !== source.topRisks.length || watch.length !== source.watch.length) return null;
  return { headline: headline.slice(0, 200), summary: summary.slice(0, 1200), topRisks: topRisks.map((s) => s.slice(0, 240)), watch: watch.map((s) => s.slice(0, 240)), confidence: source.confidence };
}

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

async function translateFieldwise(ai: AiBinding, gatewayId: string | undefined, v: PublicAiVerdict, lang: Code): Promise<PublicAiVerdict> {
  const t = (s: string) => translateText(ai, gatewayId, s, lang);
  const [headline, summary, topRisks, watch] = await Promise.all([t(v.headline), t(v.summary), Promise.all(v.topRisks.map(t)), Promise.all(v.watch.map(t))]);
  return { headline, summary, topRisks, watch, confidence: v.confidence };
}

export async function translateVerdict(ai: AiBinding, gatewayId: string | undefined, v: PublicAiVerdict, lang: Code): Promise<PublicAiVerdict> {
  const language = TABLE[lang].name.replace(/^./, (c) => c.toUpperCase());
  const out = await generateStructured<Record<string, unknown>>(ai, gatewayId, {
    model: MODELS.multilingual,
    system: translationSystem(language),
    user: JSON.stringify({ headline: v.headline, summary: v.summary, topRisks: v.topRisks, watch: v.watch }),
    schema: SCHEMA,
    maxTokens: 900,
    temperature: 0.2,
    gateway: { cacheTtl: 86_400, label: `translate-${lang}` },
  });
  const accepted = out ? acceptTranslation(out.data, v) : null;
  return accepted ?? translateFieldwise(ai, gatewayId, v, lang);
}
