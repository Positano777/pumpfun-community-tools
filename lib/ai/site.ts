/**
 * Deep website forensics with Browser Run (headless Chrome on Cloudflare's
 * network, called through the binding's quickAction(), no API token) plus a
 * Workers AI review of what the page actually renders. Drainer kits are
 * client-side: a plain fetch of a SPA sees an empty shell, the rendered page
 * shows the "connect wallet to claim" lure.
 */
import type { AiBinding, BrowserLike, R2Like } from '../env';
import { generateStructured } from './workers-ai';

export interface SiteReview {
  url: string;
  verdict: 'clean' | 'suspicious' | 'drainer-likely' | 'unreachable';
  lures: string[];
  asksForWallet: boolean;
  impersonates: string | null;
  summary: string;
  screenshotKey: string | null;
  renderedChars: number;
  model: string | null;
}

const SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['clean', 'suspicious', 'drainer-likely'] },
    lures: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    asksForWallet: { type: 'boolean' },
    impersonates: { type: 'string', description: 'Brand or project the site pretends to be, or empty string.' },
    summary: { type: 'string', description: 'Two sentences max.' },
  },
  required: ['verdict', 'lures', 'asksForWallet', 'impersonates', 'summary'],
};

async function readQuickAction(res: unknown): Promise<{ text: string | null; bytes: ArrayBuffer | null; type: string | null }> {
  if (res instanceof Response) {
    const type = res.headers.get('content-type');
    if (type?.startsWith('image/')) return { text: null, bytes: await res.arrayBuffer(), type };
    const raw = await res.text();
    try {
      const j = JSON.parse(raw) as { result?: unknown };
      return { text: typeof j.result === 'string' ? j.result : raw, bytes: null, type };
    } catch {
      return { text: raw, bytes: null, type };
    }
  }
  if (typeof res === 'string') return { text: res, bytes: null, type: 'text/plain' };
  if (res instanceof ArrayBuffer) return { text: null, bytes: res, type: 'image/png' };
  const r = res as { result?: unknown } | null;
  return { text: typeof r?.result === 'string' ? r.result : null, bytes: null, type: null };
}

export async function reviewSite(
  browser: BrowserLike | undefined,
  ai: AiBinding | undefined,
  reports: R2Like | undefined,
  gatewayId: string | undefined,
  url: string,
): Promise<SiteReview> {
  const base: SiteReview = { url, verdict: 'unreachable', lures: [], asksForWallet: false, impersonates: null, summary: 'Page could not be rendered.', screenshotKey: null, renderedChars: 0, model: null };
  if (!browser) return { ...base, summary: 'Browser Run binding not configured.' };

  const [md, shot] = await Promise.all([
    browser.quickAction('markdown', { url, gotoOptions: { waitUntil: 'networkidle2', timeout: 15_000 } }).then(readQuickAction).catch(() => null),
    browser.quickAction('screenshot', { url, viewport: { width: 1280, height: 800 }, gotoOptions: { waitUntil: 'networkidle2', timeout: 15_000 } }).then(readQuickAction).catch(() => null),
  ]);

  let screenshotKey: string | null = null;
  if (shot?.bytes && reports) {
    screenshotKey = `screens/${await sha256(url)}.png`;
    await reports.put(screenshotKey, shot.bytes, { httpMetadata: { contentType: 'image/png' } }).catch(() => (screenshotKey = null));
  }
  const text = (md?.text ?? '').slice(0, 12_000);
  if (!text) return { ...base, screenshotKey };

  if (!ai) return { ...base, verdict: 'suspicious', summary: 'Rendered, but no AI binding to review it.', screenshotKey, renderedChars: text.length };
  const out = await generateStructured<{ verdict: SiteReview['verdict']; lures: string[]; asksForWallet: boolean; impersonates: string; summary: string }>(ai, gatewayId, {
    system:
      'You audit crypto token websites for wallet-drainer and phishing patterns. Judge only the rendered page text you are given. Lures include: claim or airdrop buttons, "connect wallet to verify", fake migration or V2 swap pages, countdowns to free tokens, support chats asking for seed phrases. A plain memecoin page with links and art is clean. Never use the em dash character.',
    user: `URL: ${url}\nRENDERED PAGE (markdown):\n${text}`,
    schema: SCHEMA,
    maxTokens: 500,
    gateway: { cacheTtl: 3600, label: 'site-review' },
  });
  if (!out) return { ...base, verdict: 'suspicious', summary: 'Rendered, AI review unavailable.', screenshotKey, renderedChars: text.length };
  return {
    url,
    verdict: ['clean', 'suspicious', 'drainer-likely'].includes(out.data.verdict) ? out.data.verdict : 'suspicious',
    lures: (out.data.lures ?? []).slice(0, 5),
    asksForWallet: Boolean(out.data.asksForWallet),
    impersonates: out.data.impersonates?.trim() || null,
    summary: String(out.data.summary ?? '').replace(/\u2014/g, ', '),
    screenshotKey,
    renderedChars: text.length,
    model: out.model,
  };
}

async function sha256(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
