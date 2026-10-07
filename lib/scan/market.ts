import type { Finding, Market } from './types';
import type { ScanContext } from './context';
import { cached, fetchJson } from './context';
import { plural } from '../format';

interface DexPair {
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; symbol: string; name: string };
  quoteToken: { address: string; symbol: string };
  priceUsd?: string;
  txns?: Record<string, { buys: number; sells: number }>;
  volume?: Record<string, number>;
  priceChange?: Record<string, number>;
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: { imageUrl?: string; websites?: { url: string; label?: string }[]; socials?: { type: string; url: string }[] };
}

/**
 * Market data from DexScreener's public API. A browser User-Agent is required
 * (a bare client gets 403). Cached for 60s: price moves, structure does not.
 * A failed lookup throws (and is never cached) so the report marks market
 * data as unchecked instead of claiming there is no pool.
 */
export async function loadMarket(ctx: ScanContext, mint: string): Promise<Market | null> {
  const pairs = await cached(ctx, `dex:${mint}`, 60, async () => {
    const url = `https://api.dexscreener.com/tokens/v1/solana/${mint}`;
    const res =
      (await fetchJson<DexPair[]>(ctx, url, 6000, 1_500_000).catch(() => null)) ??
      (await new Promise((r) => setTimeout(r, 400)).then(() => fetchJson<DexPair[]>(ctx, url, 6000, 1_500_000)).catch(() => null));
    if (!Array.isArray(res)) throw new Error('DexScreener unavailable');
    return res;
  });
  const own = pairs.filter((p) => p.baseToken?.address === mint || p.quoteToken?.address === mint);
  if (!own.length) return null;
  own.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  const p = own[0];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : v != null && !Number.isNaN(Number(v)) ? Number(v) : null);
  const oldest = own.reduce<number | null>((min, x) => (x.pairCreatedAt && (!min || x.pairCreatedAt < min) ? x.pairCreatedAt : min), null);
  return {
    dex: p.dexId,
    pairAddress: p.pairAddress,
    url: p.url,
    priceUsd: num(p.priceUsd),
    liquidityUsd: p.liquidity?.usd ?? 0,
    totalLiquidityUsd: own.reduce((s, x) => s + (x.liquidity?.usd ?? 0), 0),
    fdv: num(p.fdv),
    marketCap: num(p.marketCap),
    volume24h: num(p.volume?.h24),
    buys24h: num(p.txns?.h24?.buys),
    sells24h: num(p.txns?.h24?.sells),
    buys1h: num(p.txns?.h1?.buys),
    sells1h: num(p.txns?.h1?.sells),
    priceChange1h: num(p.priceChange?.h1),
    priceChange24h: num(p.priceChange?.h24),
    pairCreatedAt: oldest,
    pairs: own.length,
    quoteSymbol: p.baseToken?.address === mint ? p.quoteToken?.symbol ?? null : p.baseToken?.symbol ?? null,
    websites: (p.info?.websites ?? []).map((w) => w.url).filter(Boolean),
    socials: (p.info?.socials ?? []).filter((s) => s?.url),
    imageUrl: p.info?.imageUrl ?? null,
  };
}

export function marketFindings(market: Market | null, now: number, launchpadCurve: boolean): Finding[] {
  const findings: Finding[] = [];
  if (!market) {
    findings.push({
      id: 'NO_POOL',
      severity: launchpadCurve ? 'info' : 'medium',
      category: 'market',
      title: launchpadCurve ? 'Trading on a bonding curve only' : 'No DEX pool indexed',
      detail: launchpadCurve
        ? 'The token has not graduated to an AMM pool. On a curve there is no LP to pull: the rug is the dev or insiders dumping into the curve.'
        : 'No pool was found on any DEX DexScreener indexes. You may be unable to sell, or price data is manufactured elsewhere.',
      weight: launchpadCurve ? 0 : 15,
    });
    return findings;
  }

  const liq = market.totalLiquidityUsd;
  const curve = /pump|moonshot|launchlab|bonk|believe|dbc/i.test(market.dex) && liq === 0;
  if (curve) {
    findings.push({
      id: 'ON_BONDING_CURVE',
      severity: 'info',
      category: 'market',
      title: `Trading on the ${market.dex} bonding curve`,
      detail: 'Not graduated to an AMM pool yet. There is no LP to pull: on a curve the rug is the dev or insiders dumping into it.',
      weight: 0,
      evidence: [{ label: 'Curve', value: market.pairAddress, href: market.url }],
    });
  } else if (liq < 5_000) {
    findings.push({
      id: 'LOW_LIQUIDITY',
      severity: 'high',
      category: 'market',
      title: `Liquidity is only $${fmt(liq)}`,
      detail: 'A pool this thin moves 20 to 50% on a single mid-size sell. Exits will be brutal.',
      weight: 18,
      evidence: [{ label: 'Pool', value: market.pairAddress, href: market.url }],
    });
  } else if (liq < 25_000) {
    findings.push({
      id: 'THIN_LIQUIDITY',
      severity: 'medium',
      category: 'market',
      title: `Thin liquidity: $${fmt(liq)}`,
      detail: 'Expect heavy slippage on anything but small trades.',
      weight: 8,
      evidence: [{ label: 'Pool', value: market.pairAddress, href: market.url }],
    });
  }

  const cap = market.marketCap ?? market.fdv;
  if (cap && liq > 0 && cap / liq > 50 && cap > 100_000) {
    findings.push({
      id: 'LIQ_TO_MCAP',
      severity: 'medium',
      category: 'market',
      title: `Market cap is ${Math.round(cap / liq)}x the liquidity`,
      detail: 'The headline valuation cannot be realised: only a sliver of it could ever be sold into the pool.',
      weight: 8,
    });
  }

  if (market.pairCreatedAt) {
    const ageH = (now - market.pairCreatedAt) / 3_600_000;
    if (ageH < 24) {
      findings.push({
        id: 'NEW_PAIR',
        severity: 'low',
        category: 'market',
        title: `Pool is ${ageH < 1 ? plural(Math.max(1, Math.round(ageH * 60)), 'minute') : plural(Math.round(ageH), 'hour')} old`,
        detail: 'Most rugs and dev dumps happen in the first 24 hours. Measured on trending launches: 10 of 13 were dead within hours.',
        weight: 6,
      });
    }
  }

  const b = market.buys1h ?? 0;
  const s = market.sells1h ?? 0;
  if (s > 20 && s > b * 2.5) {
    findings.push({
      id: 'SELL_PRESSURE',
      severity: 'medium',
      category: 'market',
      title: `Heavy selling: ${plural(s, 'sell')} vs ${plural(b, 'buy')} in the last hour`,
      detail: 'Insiders or early buyers are exiting.',
      weight: 8,
    });
  }
  if ((market.priceChange1h ?? 0) <= -50) {
    findings.push({
      id: 'PRICE_COLLAPSE',
      severity: 'high',
      category: 'market',
      title: `Price down ${Math.abs(market.priceChange1h!).toFixed(0)}% in the last hour`,
      detail: 'A collapse this fast usually means the dump already happened.',
      weight: 20,
    });
  }
  return findings;
}

export function fmt(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}
