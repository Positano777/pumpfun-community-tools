import type { D1Like } from './env';
import type { ScanReport } from './scan/types';
import type { ScanHistory } from './scan/context';

export interface FeedRow {
  address: string;
  kind: 'token' | 'wallet';
  name: string | null;
  symbol: string | null;
  image: string | null;
  risk: number;
  grade: string;
  launchpad: string | null;
  top_flags: string | null;
  scan_count: number;
  updated_at: number;
}

export async function recordScan(db: D1Like | undefined, report: ScanReport): Promise<void> {
  if (!db) return;
  const now = Date.now();
  const isToken = report.kind === 'token';
  const address = isToken ? report.mint : report.address;
  const flags = report.findings.filter((f) => f.weight > 0).slice(0, 3).map((f) => f.title);
  await db
    .prepare(
      `INSERT INTO scans (address, kind, name, symbol, image, risk, grade, deployer, launchpad, top_flags, scan_count, first_seen, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1, ?11, ?11)
       ON CONFLICT(address) DO UPDATE SET
         name = excluded.name, symbol = excluded.symbol, image = excluded.image, risk = excluded.risk,
         grade = excluded.grade, deployer = COALESCE(excluded.deployer, scans.deployer),
         launchpad = COALESCE(excluded.launchpad, scans.launchpad), top_flags = excluded.top_flags,
         scan_count = scans.scan_count + 1, updated_at = excluded.updated_at`,
    )
    .bind(
      address,
      report.kind,
      isToken ? report.token.name : report.label,
      isToken ? report.token.symbol : null,
      isToken ? report.token.image : null,
      report.risk.score,
      report.risk.grade,
      isToken ? report.launch?.deployer ?? null : null,
      isToken ? report.launch?.launchpad ?? null : report.accountType,
      JSON.stringify(flags),
      now,
    )
    .run();
}

export async function feed(db: D1Like | undefined, opts: { grade?: 'risky' | 'all'; limit?: number } = {}): Promise<FeedRow[]> {
  if (!db) return [];
  const limit = Math.min(opts.limit ?? 20, 50);
  const sql =
    opts.grade === 'risky'
      ? `SELECT * FROM scans WHERE kind = 'token' AND grade IN ('HIGH','CRITICAL') ORDER BY updated_at DESC LIMIT ?1`
      : `SELECT * FROM scans ORDER BY updated_at DESC LIMIT ?1`;
  const { results } = await db.prepare(sql).bind(limit).all<FeedRow>();
  return results;
}

export async function stats(db: D1Like | undefined): Promise<{ scans: number; flagged: number; tokens: number; wallets: number }> {
  if (!db) return { scans: 0, flagged: 0, tokens: 0, wallets: 0 };
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(scan_count),0) AS scans,
              SUM(CASE WHEN grade IN ('HIGH','CRITICAL') THEN 1 ELSE 0 END) AS flagged,
              SUM(CASE WHEN kind='token' THEN 1 ELSE 0 END) AS tokens,
              SUM(CASE WHEN kind='wallet' THEN 1 ELSE 0 END) AS wallets
         FROM scans`,
    )
    .first<{ scans: number; flagged: number; tokens: number; wallets: number }>();
  return { scans: row?.scans ?? 0, flagged: row?.flagged ?? 0, tokens: row?.tokens ?? 0, wallets: row?.wallets ?? 0 };
}

/** D1-backed history for the engine: earlier flagged launches by the same deployer. */
export function d1History(db: D1Like | undefined): ScanHistory | undefined {
  if (!db) return undefined;
  return {
    async flaggedByDeployer(deployer, exclude) {
      const { results } = await db
        .prepare(`SELECT address, symbol, risk FROM scans WHERE deployer = ?1 AND address != ?2 AND risk >= 45 ORDER BY updated_at DESC LIMIT 5`)
        .bind(deployer, exclude)
        .all<{ address: string; symbol: string | null; risk: number }>();
      return results;
    },
  };
}

export async function addWatch(db: D1Like | undefined, address: string, kind: 'token' | 'wallet', label: string | null, risk: number, grade: string, liquidity: number | null): Promise<void> {
  if (!db) throw new Error('Database unavailable');
  await db
    .prepare(
      `INSERT INTO watchlist (address, kind, label, last_risk, last_grade, last_liquidity, last_checked, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
       ON CONFLICT(address) DO NOTHING`,
    )
    .bind(address, kind, label, risk, grade, liquidity, Date.now())
    .run();
}

export async function alertsFor(db: D1Like | undefined, address: string): Promise<{ severity: string; message: string; created_at: number }[]> {
  if (!db) return [];
  const { results } = await db
    .prepare(`SELECT severity, message, created_at FROM alerts WHERE address = ?1 ORDER BY created_at DESC LIMIT 10`)
    .bind(address)
    .all<{ severity: string; message: string; created_at: number }>();
  return results;
}
