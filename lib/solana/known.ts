/**
 * Reference data the engine reasons with. Every program id and mint below was
 * verified live on mainnet (getMultipleAccounts: executable / parsed mint) and
 * every mint's symbol cross-checked against DexScreener on 2026-10-07.
 * Nothing here is a guess: an unverified label on a security product is worse
 * than no label.
 */

export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const METAPLEX_METADATA_PROGRAM = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
export const BPF_UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
export const INCINERATOR = '1nc1nerator11111111111111111111111111111111';
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

export type VenueKind = 'launchpad' | 'amm' | 'aggregator' | 'locker' | 'multisig' | 'core' | 'orderbook';

export interface KnownProgram {
  name: string;
  kind: VenueKind;
}

export const KNOWN_PROGRAMS: Record<string, KnownProgram> = {
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': { name: 'pump.fun', kind: 'launchpad' },
  pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: { name: 'PumpSwap', kind: 'amm' },
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': { name: 'Raydium AMM v4', kind: 'amm' },
  CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C: { name: 'Raydium CPMM', kind: 'amm' },
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: { name: 'Raydium CLMM', kind: 'amm' },
  LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj: { name: 'Raydium LaunchLab', kind: 'launchpad' },
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: { name: 'Orca Whirlpool', kind: 'amm' },
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: { name: 'Meteora DLMM', kind: 'amm' },
  Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB: { name: 'Meteora DAMM v1', kind: 'amm' },
  cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG: { name: 'Meteora DAMM v2', kind: 'amm' },
  dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN: { name: 'Meteora Dynamic Bonding Curve', kind: 'launchpad' },
  MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG: { name: 'Moonshot', kind: 'launchpad' },
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: { name: 'Jupiter Aggregator v6', kind: 'aggregator' },
  LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn: { name: 'Jupiter Lock', kind: 'locker' },
  strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m: { name: 'Streamflow', kind: 'locker' },
  SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf: { name: 'Squads v4 Multisig', kind: 'multisig' },
  SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu: { name: 'Squads v3 Multisig', kind: 'multisig' },
  PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY: { name: 'Phoenix', kind: 'orderbook' },
  opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb: { name: 'OpenBook v2', kind: 'orderbook' },
  metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s: { name: 'Metaplex Token Metadata', kind: 'core' },
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: { name: 'SPL Token', kind: 'core' },
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: { name: 'Token-2022', kind: 'core' },
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: { name: 'Associated Token Account', kind: 'core' },
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: { name: 'Memo', kind: 'core' },
  ComputeBudget111111111111111111111111111111: { name: 'Compute Budget', kind: 'core' },
  BPFLoaderUpgradeab1e11111111111111111111111: { name: 'BPF Upgradeable Loader', kind: 'core' },
  AddressLookupTab1e1111111111111111111111111: { name: 'Address Lookup Table', kind: 'core' },
  Stake11111111111111111111111111111111111111: { name: 'Stake Program', kind: 'core' },
  Vote111111111111111111111111111111111111111: { name: 'Vote Program', kind: 'core' },
  '11111111111111111111111111111111': { name: 'System Program', kind: 'core' },
};

/** Well-known non-program accounts (PDAs / authorities), verified on chain. */
export const KNOWN_ACCOUNTS: Record<string, string> = {
  '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1': 'Raydium AMM v4 authority',
  [INCINERATOR]: 'Solana Incinerator (burn address)',
};

/**
 * Blue-chip mints by canonical symbol. A token whose name or symbol
 * normalises to one of these, but whose mint differs, is an impersonation.
 */
export const BLUE_CHIPS: Record<string, { mint: string; name: string }> = {
  USDC: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', name: 'USD Coin' },
  USDT: { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', name: 'Tether USD' },
  SOL: { mint: WSOL_MINT, name: 'Wrapped SOL' },
  WSOL: { mint: WSOL_MINT, name: 'Wrapped SOL' },
  JUP: { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', name: 'Jupiter' },
  BONK: { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', name: 'Bonk' },
  WIF: { mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', name: 'dogwifhat' },
  PYTH: { mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', name: 'Pyth Network' },
  JTO: { mint: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', name: 'Jito' },
  RAY: { mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', name: 'Raydium' },
  ORCA: { mint: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', name: 'Orca' },
  MSOL: { mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', name: 'Marinade staked SOL' },
  JITOSOL: { mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', name: 'Jito Staked SOL' },
  JUPSOL: { mint: 'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v', name: 'Jupiter Staked SOL' },
  BSOL: { mint: 'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1', name: 'BlazeStake Staked SOL' },
  POPCAT: { mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', name: 'Popcat' },
  TRUMP: { mint: '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN', name: 'OFFICIAL TRUMP' },
  PYUSD: { mint: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', name: 'PayPal USD' },
  RENDER: { mint: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof', name: 'Render' },
  W: { mint: '85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ', name: 'Wormhole' },
  HNT: { mint: 'hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux', name: 'Helium' },
  KMNO: { mint: 'KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS', name: 'Kamino' },
  DRIFT: { mint: 'DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7', name: 'Drift' },
  PENGU: { mint: '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv', name: 'Pudgy Penguins' },
  FARTCOIN: { mint: '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump', name: 'Fartcoin' },
  MEW: { mint: 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5', name: 'cat in a dogs world' },
  GOAT: { mint: 'CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump', name: 'Goatseus Maximus' },
  PNUT: { mint: '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump', name: 'Peanut the Squirrel' },
  MOODENG: { mint: 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY', name: 'Moo Deng' },
  GRASS: { mint: 'Grass7B4RdKfBCjTKgSqnXkqjwiGvQyFbuSCUJr3XXjs', name: 'Grass' },
  CLOUD: { mint: 'CLoUDKc4Ane7HeQcPpE3YHnznRxhMimJ4MyaUqyHFzAu', name: 'Sanctum' },
};

/** Mints whose live mint/freeze authority is expected (regulated issuers). */
export const REGULATED_ISSUER_MINTS = new Set([
  BLUE_CHIPS.USDC.mint,
  BLUE_CHIPS.USDT.mint,
  BLUE_CHIPS.PYUSD.mint,
]);

export const BLUE_CHIP_MINTS = new Set(Object.values(BLUE_CHIPS).map((b) => b.mint));

/**
 * Domains of major brands. A memecoin whose metadata `website` points at one
 * of these is borrowing a brand's credibility (measured in the field: clones
 * pointing their website at nickelodeon.com and microsoft.com).
 */
export const BRAND_DOMAINS = new Set([
  'google.com', 'microsoft.com', 'apple.com', 'amazon.com', 'meta.com', 'netflix.com', 'disney.com',
  'nickelodeon.com', 'nick.com', 'tesla.com', 'spacex.com', 'x.ai', 'openai.com', 'nvidia.com', 'paypal.com',
  'visa.com', 'mastercard.com', 'coinbase.com', 'binance.com', 'kraken.com', 'robinhood.com', 'solana.com',
  'phantom.app', 'phantom.com', 'jup.ag', 'raydium.io', 'orca.so', 'circle.com', 'tether.to', 'whitehouse.gov',
  'nasa.gov', 'cnn.com', 'bbc.com', 'nytimes.com', 'cocacola.com', 'nike.com', 'mcdonalds.com', 'starbucks.com',
  'pepsi.com', 'samsung.com', 'sony.com', 'nintendo.com',
]);

/**
 * User-content platforms. A token "website" on one of these is a link to
 * someone's post or repo (narrative sourcing), not brand impersonation.
 */
export const UGC_DOMAINS = new Set([
  'github.com', 'reddit.com', 'youtube.com', 'youtu.be', 'tiktok.com', 'instagram.com', 'facebook.com',
  'linkedin.com', 'wikipedia.org', 'medium.com', 'substack.com', 'twitch.tv', 'kick.com', 'imgur.com',
  'linktr.ee', 'notion.site', 'gitbook.io',
]);

/** X/Twitter handles of brands and public figures commonly hijacked by clones. */
export const BRAND_HANDLES = new Set([
  'elonmusk', 'solana', 'phantom', 'jupiterexchange', 'raydiumprotocol', 'binance', 'cz_binance', 'coinbase',
  'brian_armstrong', 'realdonaldtrump', 'potus', 'whitehouse', 'nasa', 'spacex', 'tesla', 'openai', 'sama',
  'microsoft', 'google', 'apple', 'nickelodeon', 'disney', 'netflix', 'nvidia', 'aeyakovenko', 'rajgokal',
  'vitalikbuterin', 'tether_to', 'circle', 'paypal', 'kanyewest', 'kimkardashian', 'mrbeast', 'drake',
]);

export function programLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  return KNOWN_PROGRAMS[id]?.name ?? KNOWN_ACCOUNTS[id] ?? null;
}
