import type { Finding, TokenInfo } from './types';
import type { ScanContext } from './context';
import { cached, fetchJson } from './context';
import { decodeMetaplexMetadata } from '../solana/metaplex';
import { metaplexMetadataPda } from '../solana/address';

export interface OffchainMetadata {
  name?: string;
  symbol?: string;
  description?: string;
  image?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  createdOn?: string;
  extensions?: Record<string, unknown>;
}

export interface MetadataResult {
  info: Pick<TokenInfo, 'name' | 'symbol' | 'image' | 'description' | 'uri' | 'isMutable' | 'updateAuthority' | 'metadataSource'>;
  offchain: OffchainMetadata | null;
  findings: Finding[];
  /** Metaplex creators, verified first: candidate launchers. */
  creators: string[];
}

/**
 * IPFS gateways in preference order. The free public path gateways are not
 * dependable (measured 2026-09-21: ipfs.io and dweb.link answering 429), so
 * several are tried with a short timeout each.
 */
const IPFS_GATEWAYS = ['https://ipfs.filebase.io/ipfs/', 'https://ipfs.io/ipfs/', 'https://dweb.link/ipfs/'];

export function gatewayUrls(uri: string): string[] {
  const u = uri.trim();
  const cid = u.startsWith('ipfs://') ? u.slice(7).replace(/^ipfs\//, '') : u.match(/\/ipfs\/(.+)$/)?.[1];
  if (cid) {
    const direct = u.startsWith('http') ? [u] : [];
    return [...direct, ...IPFS_GATEWAYS.map((g) => g + cid)].filter((v, i, a) => a.indexOf(v) === i);
  }
  if (u.startsWith('ar://')) return [`https://arweave.net/${u.slice(5)}`];
  if (u.startsWith('https://') || u.startsWith('http://')) return [u];
  return [];
}

export async function loadMetadata(
  ctx: ScanContext,
  mint: string,
  token2022Meta: { name: string; symbol: string; uri: string; updateAuthority: string | null } | null,
): Promise<MetadataResult> {
  const findings: Finding[] = [];
  let name: string | null = null;
  let symbol: string | null = null;
  let uri: string | null = null;
  let isMutable: boolean | null = null;
  let updateAuthority: string | null = null;
  let source: TokenInfo['metadataSource'] = 'none';
  let creators: string[] = [];

  if (token2022Meta) {
    name = token2022Meta.name || null;
    symbol = token2022Meta.symbol || null;
    uri = token2022Meta.uri || null;
    updateAuthority = token2022Meta.updateAuthority;
    isMutable = Boolean(updateAuthority);
    source = 'token-2022';
  } else {
    const pda = metaplexMetadataPda(mint);
    const acct = await ctx.rpc.call<{ value: { data: [string, string] } | null }>('getAccountInfo', [pda, { encoding: 'base64' }]);
    const decoded = acct.value ? decodeMetaplexMetadata(acct.value.data[0]) : null;
    if (decoded) {
      name = decoded.name || null;
      symbol = decoded.symbol || null;
      uri = decoded.uri || null;
      updateAuthority = decoded.updateAuthority;
      isMutable = decoded.isMutable;
      source = 'metaplex';
      creators = [...decoded.creators].sort((a, b) => Number(b.verified) - Number(a.verified)).map((c) => c.address);
    }
  }

  if (source === 'none') {
    findings.push({
      id: 'NO_METADATA',
      severity: 'medium',
      category: 'metadata',
      title: 'No on-chain metadata',
      detail: 'The token has no name, symbol or logo on chain. Wallets show it as an unknown token, a pattern common in spam and drainer airdrops.',
      weight: 12,
    });
  } else if (isMutable) {
    findings.push({
      id: 'METADATA_MUTABLE',
      severity: 'medium',
      category: 'metadata',
      title: 'Metadata is mutable',
      detail: 'The update authority can change the name, ticker, logo and links after you buy. Rebrands into a copy of a trending token are a known exit play.',
      weight: 10,
      evidence: [{ label: 'Update authority', value: updateAuthority ?? 'unknown' }],
    });
  } else {
    findings.push({
      id: 'METADATA_IMMUTABLE',
      severity: 'good',
      category: 'metadata',
      title: 'Metadata is locked',
      detail: 'Name, ticker and logo can no longer be changed.',
      weight: 0,
    });
  }

  let offchain: OffchainMetadata | null = null;
  if (uri) {
    offchain = await cached(ctx, `meta:json:${uri}`, 86_400, async () => {
      for (const url of gatewayUrls(uri!)) {
        try {
          const json = await fetchJson<OffchainMetadata>(ctx, url, 4500, 256_000);
          if (json && typeof json === 'object') return json;
        } catch {
          // next gateway
        }
      }
      return null;
    });
    if (!offchain) {
      findings.push({
        id: 'METADATA_UNREACHABLE',
        severity: 'low',
        category: 'metadata',
        title: 'Off-chain metadata unreachable',
        detail: 'The metadata URI did not answer. The logo and links you see elsewhere cannot be verified against the chain.',
        weight: 4,
        evidence: [{ label: 'URI', value: uri }],
      });
    }
  }

  const ext = (offchain?.extensions ?? {}) as Record<string, unknown>;
  const pick = (...vals: unknown[]) => vals.find((v) => typeof v === 'string' && v.trim().length > 0) as string | undefined;

  return {
    info: {
      name: name ?? pick(offchain?.name) ?? null,
      symbol: symbol ?? pick(offchain?.symbol) ?? null,
      image: pick(offchain?.image) ?? null,
      description: pick(offchain?.description)?.slice(0, 600) ?? null,
      uri,
      isMutable,
      updateAuthority,
      metadataSource: source,
    },
    offchain: offchain
      ? {
          ...offchain,
          website: pick(offchain.website, ext.website),
          twitter: pick(offchain.twitter, ext.twitter),
          telegram: pick(offchain.telegram, ext.telegram),
        }
      : null,
    findings,
    creators,
  };
}
