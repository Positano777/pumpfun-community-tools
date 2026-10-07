/**
 * Open-web intel through Cloudflare's Web Search API (beta, routed and billed
 * through AI Gateway): has anyone already called this token, ticker or
 * deployer a scam? Results feed the copilot as citations; nothing here changes
 * the deterministic score.
 */
import type { AiBinding } from '../env';

export interface WebHit {
  title: string;
  url: string;
  description: string | null;
}

export async function webIntel(ai: AiBinding | undefined, gatewayId: string | undefined, query: string, limit = 5): Promise<WebHit[]> {
  if (!ai?.websearch) return [];
  try {
    const res = await ai.websearch({ gatewayId: gatewayId || 'default', query: query.slice(0, 300), limit });
    if (!res.ok) return [];
    const body = (await res.json()) as { results?: { title?: string; url?: string; description?: string }[]; result?: { results?: unknown[] } };
    const list = (body.results ?? (body.result?.results as typeof body.results) ?? []) as { title?: string; url?: string; description?: string }[];
    return list
      .filter((r) => r.url)
      .slice(0, limit)
      .map((r) => ({ title: String(r.title ?? r.url), url: String(r.url), description: r.description ? String(r.description).slice(0, 300) : null }));
  } catch {
    return [];
  }
}
