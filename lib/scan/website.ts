import type { Finding, Socials } from './types';
import type { ScanContext } from './context';
import { UA, cached, fetchJson, readCapped } from './context';
import { BRAND_DOMAINS, BRAND_HANDLES, UGC_DOMAINS } from '../solana/known';

const TWO_LEVEL_SUFFIXES = new Set(['co.uk', 'org.uk', 'com.au', 'co.jp', 'com.br', 'co.in', 'co.kr', 'com.cn', 'com.tr', 'co.za', 'com.mx', 'com.sg']);

export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join('.');
  return TWO_LEVEL_SUFFIXES.has(last2) ? parts.slice(-3).join('.') : last2;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
  } catch {
    return null;
  }
}

const SOCIAL_HOSTS = /(^|\.)(x\.com|twitter\.com|t\.me|telegram\.me|discord\.gg|discord\.com|instagram\.com|tiktok\.com|youtube\.com|pump\.fun|dexscreener\.com)$/i;

export interface WebsiteInput {
  metaWebsite?: string;
  metaTwitter?: string;
  metaTelegram?: string;
  dexWebsites: string[];
  dexSocials: { type: string; url: string }[];
}

export interface WebsiteResult {
  socials: Socials;
  findings: Finding[];
  /** Plain-text excerpt and lure signals of the landing page, for the AI site review. */
  page: { url: string; title: string | null; text: string; signals: string[] } | null;
}

export async function analyzeWebsite(ctx: ScanContext, input: WebsiteInput): Promise<WebsiteResult> {
  const findings: Finding[] = [];
  const candidates = [input.metaWebsite, ...input.dexWebsites].filter((u): u is string => Boolean(u && hostOf(u)));
  const website = candidates.find((u) => !SOCIAL_HOSTS.test(hostOf(u) ?? '')) ?? null;
  const twitter =
    input.metaTwitter ?? input.dexSocials.find((s) => s.type === 'twitter' || /x\.com|twitter\.com/.test(s.url))?.url ?? null;
  const telegram = input.metaTelegram ?? input.dexSocials.find((s) => s.type === 'telegram')?.url ?? null;

  const socials: Socials = { website, twitter, telegram, domain: null, domainRegisteredAt: null, domainAgeDays: null };

  if (!website && !twitter && !telegram) {
    findings.push({
      id: 'NO_SOCIALS',
      severity: 'low',
      category: 'website',
      title: 'No website or socials',
      detail: 'Nothing links this token to a team, community or accountable person.',
      weight: 5,
    });
  }

  // Borrowed brand identity: a memecoin pointing at a real company's site or account.
  if (website) {
    const host = hostOf(website)!;
    const domain = registrableDomain(host);
    socials.domain = domain;
    const path = (() => {
      try {
        return new URL(website.startsWith('http') ? website : `https://${website}`).pathname.split('/').filter(Boolean);
      } catch {
        return [];
      }
    })();
    if (UGC_DOMAINS.has(domain) || (BRAND_DOMAINS.has(domain) && path.length > 1)) {
      findings.push({
        id: 'WEBSITE_IS_THIRD_PARTY_POST',
        severity: 'info',
        category: 'website',
        title: `Website is a post on ${domain}, not a project site`,
        detail: 'Narrative tokens often link the post that inspired them. There is no project site behind it and nobody accountable for it.',
        weight: 0,
        evidence: [{ label: 'Website', value: website }],
      });
    } else if (BRAND_DOMAINS.has(domain)) {
      findings.push({
        id: 'BORROWED_WEBSITE',
        severity: 'high',
        category: 'impersonation',
        title: `Website points to ${domain}, a major brand`,
        detail: 'The token borrows a real company\'s site to look official. Measured in the field: clones pointed their links at nickelodeon.com and microsoft.com.',
        weight: 30,
        evidence: [{ label: 'Website', value: website }],
      });
    } else {
      const rdap = await cached(ctx, `rdap:${domain}`, 7 * 86_400, () => domainRegistration(ctx, domain)).catch(() => null);
      if (rdap) {
        socials.domainRegisteredAt = rdap;
        const days = Math.floor((ctx.now() - Date.parse(rdap)) / 86_400_000);
        socials.domainAgeDays = days;
        if (days < 30) {
          findings.push({
            id: 'FRESH_DOMAIN',
            severity: days < 7 ? 'medium' : 'low',
            category: 'website',
            title: `Website domain registered ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}`,
            detail: 'Throwaway domains are registered for a launch and abandoned with it.',
            weight: days < 7 ? 8 : 4,
            evidence: [{ label: 'Domain', value: domain }, { label: 'Registered', value: rdap.slice(0, 10) }],
          });
        }
      }
    }
  }

  if (twitter) {
    const m = twitter.match(/(?:x\.com|twitter\.com)\/(?:#!\/)?@?([A-Za-z0-9_]{1,15})(\/|$|\?)/i);
    const handle = m?.[1]?.toLowerCase();
    if (/\/status\/|\/i\/communities\//i.test(twitter)) {
      findings.push({
        id: 'TWITTER_NOT_ACCOUNT',
        severity: 'info',
        category: 'website',
        title: 'X link points to a post, not a project account',
        detail: 'Typical of narrative memecoins riding someone else\'s viral post. There is no project account to hold accountable.',
        weight: 0,
        evidence: [{ label: 'X link', value: twitter }],
      });
    } else if (handle && BRAND_HANDLES.has(handle)) {
      findings.push({
        id: 'BORROWED_TWITTER',
        severity: 'high',
        category: 'impersonation',
        title: `X account is @${handle}, not a project account`,
        detail: 'The token lists a famous account as its own. That account did not launch this token.',
        weight: 30,
        evidence: [{ label: 'X link', value: twitter }],
      });
    }
  }

  let page: WebsiteResult['page'] = null;
  if (website && socials.domain && !BRAND_DOMAINS.has(socials.domain) && !UGC_DOMAINS.has(socials.domain)) {
    page = await cached(ctx, `site:v1:${website}`, 3600, () => fetchPage(ctx, website)).catch(() => null);
    if (page && page.signals.includes('wallet-connect') && page.signals.includes('claim-lure')) {
      findings.push({
        id: 'SITE_CLAIM_LURE',
        severity: 'high',
        category: 'website',
        title: 'Website asks you to connect a wallet to claim something',
        detail: 'A memecoin site has no reason to request signatures. "Connect to claim your airdrop" is the standard wallet-drainer lure.',
        weight: 35,
        evidence: [{ label: 'Website', value: website }, { label: 'Signals', value: page.signals.join(', ') }],
      });
    }
    if (page?.signals.includes('approval-request') || page?.signals.includes('obfuscated-script')) {
      findings.push({
        id: 'SITE_SUSPICIOUS_SCRIPT',
        severity: 'medium',
        category: 'website',
        title: 'Website ships suspicious wallet code',
        detail: 'Obfuscated scripts or token-approval calls on a landing page are drainer-kit markers.',
        weight: 15,
        evidence: [{ label: 'Signals', value: page.signals.join(', ') }],
      });
    }
  }

  return { socials, findings, page };
}

async function domainRegistration(ctx: ScanContext, domain: string): Promise<string | null> {
  const data = await fetchJson<{ events?: { eventAction: string; eventDate: string }[] }>(ctx, `https://rdap.org/domain/${domain}`, 6000, 200_000);
  const reg = data?.events?.find((e) => e.eventAction === 'registration');
  return reg?.eventDate ?? null;
}

async function fetchPage(ctx: ScanContext, url: string): Promise<WebsiteResult['page']> {
  const res = await ctx.fetch(url.startsWith('http') ? url : `https://${url}`, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    signal: AbortSignal.timeout(6000),
    redirect: 'follow',
  });
  if (!res.ok) return null;
  const html = await readCapped(res, 400_000);
  const title = html.match(/<title[^>]*>([^<]{0,200})<\/title>/i)?.[1]?.trim() ?? null;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 3000);
  const signals: string[] = [];
  if (/signAllTransactions|signTransaction|window\.(solana|phantom|solflare)|wallet-adapter|connectWallet|connect wallet/i.test(html)) signals.push('wallet-connect');
  if (/\b(claim|airdrop|eligib|reward|allocation|whitelist|presale)\b/i.test(text)) signals.push('claim-lure');
  if (/createApproveInstruction|\bapproveChecked\b|setAuthority|createSetAuthorityInstruction/i.test(html)) signals.push('approval-request');
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
  const obfuscatorIds = scripts.match(/_0x[a-f0-9]{4,6}/gi)?.length ?? 0;
  if (/eval\s*\(\s*atob|\\x[0-9a-f]{2}(\\x[0-9a-f]{2}){40,}/i.test(scripts) || obfuscatorIds > 25) signals.push('obfuscated-script');
  return { url, title, text, signals };
}
