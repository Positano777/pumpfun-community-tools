-- RugHawk D1 schema. Idempotent: safe to re-run.

-- Latest scan per address (bounded: one row per address, upserted).
CREATE TABLE IF NOT EXISTS scans (
  address     TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,              -- 'token' | 'wallet'
  name        TEXT,
  symbol      TEXT,
  image       TEXT,
  risk        INTEGER NOT NULL,
  grade       TEXT NOT NULL,             -- LOW | ELEVATED | HIGH | CRITICAL
  deployer    TEXT,
  launchpad   TEXT,
  top_flags   TEXT,                       -- JSON array of the top finding titles
  scan_count  INTEGER NOT NULL DEFAULT 1,
  first_seen  INTEGER NOT NULL,           -- unix ms
  updated_at  INTEGER NOT NULL            -- unix ms
);
CREATE INDEX IF NOT EXISTS idx_scans_updated ON scans(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_scans_deployer ON scans(deployer, risk);
CREATE INDEX IF NOT EXISTS idx_scans_grade ON scans(grade, updated_at DESC);

-- Watchtower: tokens/wallets re-scanned on a schedule; changes become alerts.
CREATE TABLE IF NOT EXISTS watchlist (
  address        TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,
  label          TEXT,
  last_risk      INTEGER,
  last_grade     TEXT,
  last_liquidity REAL,
  last_checked   INTEGER,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  address     TEXT NOT NULL,
  kind        TEXT NOT NULL,
  severity    TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_address ON alerts(address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);

-- Community reports (moderated before they influence anything).
CREATE TABLE IF NOT EXISTS community_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  address     TEXT NOT NULL,
  reason      TEXT NOT NULL,
  reporter    TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_address ON community_reports(address);
