/**
 * Scam DNA: every scanned token's identity (name, ticker, description,
 * links) is embedded with bge-base-en-v1.5 and stored in Vectorize. A new
 * token is compared against everything RugHawk has already flagged, so a
 * serial scammer's 40th copy of the same narrative lights up even when the
 * deployer key is fresh.
 */
import type { AiBinding, VectorizeLike } from '../env';
import type { DnaMatch, TokenReport } from '../scan/types';
import { MODELS, runModel } from './workers-ai';

export function dnaText(r: TokenReport): string {
  return [r.token.name, r.token.symbol, r.token.description, r.socials.website, r.socials.twitter, r.socials.telegram]
    .filter(Boolean)
    .join(' | ')
    .slice(0, 1500);
}

export async function embed(ai: AiBinding, gatewayId: string | undefined, text: string): Promise<number[] | null> {
  try {
    const { result } = await runModel(ai, MODELS.embed, { text: [text] }, gatewayId, { cacheTtl: 86_400, label: 'dna-embed' });
    const data = (result as { data?: number[][] })?.data?.[0];
    return Array.isArray(data) && data.length ? data : null;
  } catch {
    return null;
  }
}

export async function dnaMatches(
  ai: AiBinding | undefined,
  index: VectorizeLike | undefined,
  gatewayId: string | undefined,
  report: TokenReport,
): Promise<{ matches: DnaMatch[]; vector: number[] | null }> {
  if (!ai || !index) return { matches: [], vector: null };
  const text = dnaText(report);
  if (text.length < 6) return { matches: [], vector: null };
  const vector = await embed(ai, gatewayId, text);
  if (!vector) return { matches: [], vector: null };
  try {
    const res = await index.query(vector, { topK: 8, returnMetadata: 'all' });
    const matches = res.matches
      .filter((m) => m.id !== report.mint && m.score >= 0.88 && Number(m.metadata?.risk ?? 0) >= 45)
      .slice(0, 5)
      .map((m) => ({
        address: m.id,
        symbol: (m.metadata?.symbol as string) ?? null,
        name: (m.metadata?.name as string) ?? null,
        risk: Number(m.metadata?.risk ?? 0),
        similarity: Math.round(m.score * 1000) / 1000,
      }));
    return { matches, vector };
  } catch {
    return { matches: [], vector };
  }
}

export async function rememberDna(index: VectorizeLike | undefined, report: TokenReport, vector: number[] | null): Promise<void> {
  if (!index || !vector) return;
  await index.upsert([
    {
      id: report.mint,
      values: vector,
      metadata: {
        name: report.token.name ?? '',
        symbol: report.token.symbol ?? '',
        risk: report.risk.score,
        grade: report.risk.grade,
        deployer: report.launch?.deployer ?? '',
        scannedAt: report.scannedAt,
      },
    },
  ]);
}
