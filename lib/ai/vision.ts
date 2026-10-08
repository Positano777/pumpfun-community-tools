/**
 * Logo forensics with Llama 4 Scout's vision: does this token's image copy a
 * well-known brand? Clones lift USDC's blue coin, Solana's gradient bars or a
 * trending memecoin's mascot so the token looks right in a wallet list.
 */
import type { AiBinding } from '../env';
import { MODELS, generateStructured } from './workers-ai';
import { noneToNull } from './site';

export interface LogoReview {
  brand: string | null;
  confidence: number;
  description: string;
  model: string;
}

/** The review as the UI and API see it: no model identifiers. */
export type PublicLogoReview = Omit<LogoReview, 'model'>;

export function publicLogoReview(r: LogoReview): PublicLogoReview {
  return { brand: r.brand, confidence: r.confidence, description: r.description };
}

const SCHEMA = {
  type: 'object',
  properties: {
    brand: { type: 'string', description: 'Well-known crypto or corporate brand the logo imitates, or empty string.' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    description: { type: 'string', description: 'One sentence describing the image.' },
  },
  required: ['brand', 'confidence', 'description'],
};

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function reviewLogo(ai: AiBinding | undefined, gatewayId: string | undefined, imageUrl: string, claimed: { name: string | null; symbol: string | null }): Promise<LogoReview | null> {
  if (!ai || !/^https:\/\//.test(imageUrl)) return null;
  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(6000) });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !/^image\/(png|jpe?g|webp|gif)/.test(type)) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 1_500_000) return null;
    const dataUri = `data:${type.split(';')[0]};base64,${toBase64(buf)}`;
    const out = await generateStructured<{ brand: string; confidence: number; description: string }>(ai, gatewayId, {
      model: MODELS.vision,
      system: 'You are a brand-forensics analyst. Identify whether a token logo imitates a well-known brand (stablecoins, major tokens, wallets, exchanges, corporations, famous memecoins). Never use the em dash character.',
      user: [
        { type: 'text', text: `This token calls itself "${claimed.name ?? '?'}" (${claimed.symbol ?? '?'}). Which brand, if any, does its logo imitate?` },
        { type: 'image_url', image_url: { url: dataUri } },
      ],
      schema: SCHEMA,
      maxTokens: 250,
      gateway: { cacheTtl: 86_400, label: 'logo-vision' },
    });
    if (!out) return null;
    return {
      brand: noneToNull(out.data.brand),
      confidence: Math.max(0, Math.min(1, Number(out.data.confidence) || 0)),
      description: String(out.data.description ?? '').replace(/\u2014/g, ', '),
      model: out.model,
    };
  } catch {
    return null;
  }
}
