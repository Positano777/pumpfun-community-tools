import { NextResponse } from 'next/server';
import { NotAMintError } from './scan/token';
import { HttpError } from './errors';

export { HttpError };

export function json(data: unknown, init: { status?: number; cache?: number } = {}) {
  return NextResponse.json(data, {
    status: init.status ?? 200,
    headers: { 'Cache-Control': init.cache ? `public, max-age=${init.cache}, s-maxage=${init.cache}` : 'no-store' },
  });
}

export function fail(e: unknown, fallbackStatus = 500) {
  if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, { status: e.status });
  if (e instanceof NotAMintError) return json({ error: e.message, accountType: e.accountType }, { status: 422 });
  const message = e instanceof Error ? e.message : 'Unexpected error';
  const status = /invalid solana address/i.test(message) ? 400 : fallbackStatus;
  if (status >= 500) console.error('[rughawk] request failed:', message);
  return json({ error: status >= 500 ? 'Scan failed. The network or a provider is slow; try again in a moment.' : message, detail: status >= 500 ? message.slice(0, 200) : undefined }, { status });
}

/** API-plan responses carry the monthly quota position. */
export function withQuota<T extends Response>(res: T, quota: { used: number; limit: number } | null): T {
  if (quota) {
    res.headers.set('X-RugHawk-Quota-Limit', String(quota.limit));
    res.headers.set('X-RugHawk-Quota-Used', String(quota.used));
    res.headers.set('X-RugHawk-Quota-Remaining', String(Math.max(0, quota.limit - quota.used)));
  }
  return res;
}

const ALLOWED_HOSTS = ['rughawk.xyz', 'rughawk.com', 'rughawk.app', 'rughawk.dev'];

export function hostAllowed(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return (
      ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) ||
      host.endsWith('.workers.dev') ||
      host === 'localhost' ||
      host === '127.0.0.1'
    );
  } catch {
    return false;
  }
}

/**
 * Browser-only endpoints: a request without an allowed Origin is accepted only
 * when it carries Sec-Fetch-Site (browsers stamp it, scripted clients do not).
 * Lesson carried over from Solmint: trusting a missing Origin made the RPC
 * proxy an open relay on a paid endpoint.
 */
export function originAllowed(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (origin) return hostAllowed(origin);
  const site = req.headers.get('sec-fetch-site');
  return site === 'same-origin' || site === 'same-site';
}
