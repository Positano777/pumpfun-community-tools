export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info' | 'good';

export type Category =
  | 'authority'
  | 'extension'
  | 'metadata'
  | 'holders'
  | 'market'
  | 'launch'
  | 'deployer'
  | 'impersonation'
  | 'website'
  | 'program'
  | 'activity'
  | 'funding'
  | 'exposure'
  | 'intel';

export interface Evidence {
  label: string;
  value: string;
  href?: string;
}

export interface Finding {
  id: string;
  severity: Severity;
  category: Category;
  title: string;
  detail: string;
  /** 0..100 contribution to the noisy-OR risk score; 0 for info/good. */
  weight: number;
  evidence?: Evidence[];
}

export type Grade = 'LOW' | 'ELEVATED' | 'HIGH' | 'CRITICAL';

export interface RiskSummary {
  score: number;
  grade: Grade;
  counts: Record<Severity, number>;
}

export type HolderLabel = 'pool' | 'curve' | 'burn' | 'deployer' | 'program' | 'locker' | 'exchange' | 'wallet' | 'unknown';

export interface Holder {
  tokenAccount: string;
  owner: string | null;
  uiAmount: number;
  pct: number;
  label: HolderLabel;
  labelDetail?: string;
}

export interface HolderStats {
  top: Holder[];
  /** % of supply in the 10 largest accounts that are plain wallets (pools, curves, burns excluded). */
  top10WalletPct: number;
  largestWalletPct: number;
  poolPct: number;
  burnedPct: number;
  lockedPct: number;
}

export interface Market {
  dex: string;
  pairAddress: string;
  url: string;
  priceUsd: number | null;
  liquidityUsd: number;
  totalLiquidityUsd: number;
  fdv: number | null;
  marketCap: number | null;
  volume24h: number | null;
  buys24h: number | null;
  sells24h: number | null;
  buys1h: number | null;
  sells1h: number | null;
  priceChange1h: number | null;
  priceChange24h: number | null;
  pairCreatedAt: number | null;
  pairs: number;
  quoteSymbol: string | null;
  websites: string[];
  socials: { type: string; url: string }[];
  imageUrl: string | null;
}

export interface FundingHop {
  address: string;
  /** Who sent this address its first SOL. */
  fundedBy: string | null;
  amountSol: number | null;
  time: number | null;
  signature: string | null;
  kind: 'wallet' | 'exchange-like' | 'program' | 'pda' | 'unknown';
  balanceSol: number | null;
  firstSeen: number | null;
  note?: string;
}

export interface LaunchForensics {
  reached: boolean;
  signaturesScanned: number;
  creationSignature: string | null;
  createdAt: number | null;
  slot: number | null;
  launchpad: string | null;
  deployer: string | null;
  devInitialPct: number | null;
  bundled: { wallets: string[]; pctOfSupply: number; txCount: number };
  devSells: { signature: string; secondsAfterLaunch: number | null; pctOfSupply: number }[];
  /** Deployer outflows that were not sales (no trading venue, no SOL back): tokens sent to other wallets. */
  devTransfers: { signature: string; secondsAfterLaunch: number | null; pctOfSupply: number; recipients: number }[];
  /** Deployer balance now, as % of supply; null when it could not be read. */
  devCurrentPct: number | null;
  /** Deployer tokens sent to a locker program (Streamflow, Jupiter Lock). */
  devLocks: { signature: string; secondsAfterLaunch: number | null; pctOfSupply: number; locker: string }[];
  /** Deployer tokens burned. */
  devBurns: { signature: string; secondsAfterLaunch: number | null; pctOfSupply: number }[];
}

export interface DeployerProfile {
  address: string;
  solBalance: number | null;
  firstSeen: number | null;
  txCount: number;
  txCountCapped: boolean;
  ageHoursAtLaunch: number | null;
  fundingChain: FundingHop[];
  tokensCreated: { mint: string; signature: string; time: number | null }[];
  sampleSize: number;
  linkedFlaggedScans: { address: string; symbol: string | null; risk: number }[];
}

export interface Socials {
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  domain: string | null;
  domainRegisteredAt: string | null;
  domainAgeDays: number | null;
}

export interface TokenInfo {
  name: string | null;
  symbol: string | null;
  image: string | null;
  description: string | null;
  decimals: number;
  supply: string;
  uiSupply: number;
  uri: string | null;
  isMutable: boolean | null;
  updateAuthority: string | null;
  metadataSource: 'metaplex' | 'token-2022' | 'none';
}

export interface ExtensionInfo {
  name: string;
  severity: Severity;
  detail: string;
}

export interface AiVerdict {
  headline: string;
  summary: string;
  topRisks: string[];
  watch: string[];
  confidence: 'low' | 'medium' | 'high';
  model: string;
}

/** The verdict as the UI and API see it: no model identifiers. */
export type PublicAiVerdict = Omit<AiVerdict, 'model'>;

export interface DnaMatch {
  address: string;
  symbol: string | null;
  name: string | null;
  risk: number;
  similarity: number;
}

export interface TokenReport {
  kind: 'token';
  version: 1;
  mint: string;
  scannedAt: number;
  durationMs: number;
  rpcCalls: number;
  /** Calls per RPC role (archive, hot, failover), when the scan ran live. */
  rpcProviders?: Record<string, number>;
  program: 'spl-token' | 'spl-token-2022';
  token: TokenInfo;
  authorities: { mint: string | null; freeze: string | null };
  extensions: ExtensionInfo[];
  holders: HolderStats | null;
  market: Market | null;
  launch: LaunchForensics | null;
  deployer: DeployerProfile | null;
  socials: Socials;
  findings: Finding[];
  risk: RiskSummary;
  ai: AiVerdict | null;
  dna: DnaMatch[];
  /** Modules that failed or were skipped, so the UI never implies a clean bill it did not check. */
  partial: string[];
}

export interface DelegateExposure {
  tokenAccount: string;
  mint: string;
  delegate: string;
  delegatedUi: number;
  balanceUi: number;
  programId: string;
}

export interface ProgramInfo {
  executable: true;
  loader: string;
  upgradeable: boolean;
  upgradeAuthority: string | null;
  authorityIsPda: boolean | null;
  lastDeploySlot: number | null;
  verified: boolean | null;
  verifiedRepo: string | null;
  label: string | null;
}

export interface WalletReport {
  kind: 'wallet';
  version: 1;
  address: string;
  scannedAt: number;
  durationMs: number;
  rpcCalls: number;
  /** Calls per RPC role (archive, hot, failover), when the scan ran live. */
  rpcProviders?: Record<string, number>;
  accountType: 'wallet' | 'program' | 'pda' | 'token-account' | 'mint' | 'stake' | 'unknown' | 'empty';
  owner: string | null;
  label: string | null;
  solBalance: number;
  activity: {
    txCount: number;
    capped: boolean;
    firstSeen: number | null;
    lastSeen: number | null;
    failedRatio: number;
    perDay: number | null;
  };
  funding: FundingHop[];
  holdings: {
    tokenAccounts: number;
    nonZero: number;
    delegated: DelegateExposure[];
    frozen: number;
    permanentDelegateTokens: { mint: string; delegate: string }[];
    empty: number;
    reclaimableSol: number;
  } | null;
  counterparties: { address: string; count: number; label: string | null }[];
  poisoning: { lookalike: string; mimics: string; signature: string | null }[];
  tokensCreated: { mint: string; signature: string; time: number | null }[];
  program: ProgramInfo | null;
  findings: Finding[];
  risk: RiskSummary;
  ai: AiVerdict | null;
  partial: string[];
}

export type ScanReport = TokenReport | WalletReport;
