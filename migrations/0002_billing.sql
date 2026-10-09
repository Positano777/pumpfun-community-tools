-- RugHawk billing, accounts and entitlements. Idempotent: safe to re-run.

-- One row per wallet that signed in. Stripe customer, alert channels.
CREATE TABLE IF NOT EXISTS accounts (
  wallet          TEXT PRIMARY KEY,
  email           TEXT,
  stripe_customer TEXT,
  telegram_chat   TEXT,
  telegram_code   TEXT,
  webhook_url     TEXT,
  webhook_secret  TEXT,
  created_at      INTEGER NOT NULL,            -- unix ms
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_customer ON accounts(stripe_customer);
CREATE INDEX IF NOT EXISTS idx_accounts_tg_code ON accounts(telegram_code);

-- Mirror of Stripe subscriptions, written only by the webhook and the
-- post-checkout sync. The wallet is '' until checkout.session.completed
-- attributes a subscription that a Payment Link created.
CREATE TABLE IF NOT EXISTS subscriptions (
  id                   TEXT PRIMARY KEY,       -- Stripe subscription id
  wallet               TEXT NOT NULL DEFAULT '',
  plan                 TEXT NOT NULL,          -- 'pro' | 'api'
  status               TEXT NOT NULL,          -- Stripe status
  customer             TEXT,
  price_id             TEXT,
  period_end           INTEGER,                -- unix ms
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subs_wallet ON subscriptions(wallet, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_subs_customer ON subscriptions(customer);

-- Processed Stripe event ids (webhooks retry; each event is applied once).
CREATE TABLE IF NOT EXISTS stripe_events (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- API plan keys: only the SHA-256 of the key is stored.
CREATE TABLE IF NOT EXISTS api_keys (
  hash       TEXT PRIMARY KEY,
  wallet     TEXT NOT NULL,
  prefix     TEXT NOT NULL,                   -- first characters, for display
  created_at INTEGER NOT NULL,
  last_used  INTEGER,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_api_keys_wallet ON api_keys(wallet);

-- Quota counters: free scans per IP per day, API calls per key per month.
CREATE TABLE IF NOT EXISTS usage_counters (
  subject TEXT NOT NULL,                      -- 'ip:<ip>' | 'key:<hash>'
  period  TEXT NOT NULL,                      -- 'YYYY-MM-DD' | 'YYYY-MM'
  n       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (subject, period)
);

-- Per-wallet Watchtower subscriptions (Pro and API plans).
CREATE TABLE IF NOT EXISTS watch_subs (
  wallet     TEXT NOT NULL,
  address    TEXT NOT NULL,
  label      TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (wallet, address)
);
CREATE INDEX IF NOT EXISTS idx_watch_subs_address ON watch_subs(address);
