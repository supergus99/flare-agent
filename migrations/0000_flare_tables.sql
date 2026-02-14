-- Flare D1 schema (run against existing D1, e.g. flare-db).
-- Usage: wrangler d1 execute flare-db --remote --file=./migrations/0000_flare_tables.sql
-- Only creates tables that don't exist; safe to run multiple times.

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_session_id TEXT UNIQUE,
  customer_email TEXT NOT NULL,
  customer_name TEXT,
  amount_cents INTEGER,
  currency TEXT DEFAULT 'eur',
  payment_status TEXT DEFAULT 'pending',
  access_hash TEXT UNIQUE,
  verification_code TEXT,
  expires_at TEXT,
  assessment_submitted_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contact_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER REFERENCES payments(id),
  email TEXT NOT NULL,
  name TEXT,
  assessment_data TEXT,
  status TEXT DEFAULT 'new',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER REFERENCES contact_submissions(id),
  payment_id INTEGER REFERENCES payments(id),
  status TEXT DEFAULT 'pending_review',
  view_hash TEXT UNIQUE,
  view_expires_at TEXT,
  r2_key TEXT,
  sent_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER,
  email_type TEXT,
  recipient_email TEXT,
  subject TEXT,
  status TEXT DEFAULT 'pending',
  sent_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automation_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payments_access_hash ON payments(access_hash);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_session ON payments(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_reports_view_hash ON reports(view_hash);
