-- Phase 3: Email logs (audit)
-- Run: npx wrangler d1 execute flare-db --remote --file=./migrations/004_phase3_email_admin.sql

CREATE TABLE IF NOT EXISTS email_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER,
  report_id INTEGER,
  email_type TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (payment_id) REFERENCES payments(id),
  FOREIGN KEY (report_id) REFERENCES reports(id)
);
CREATE INDEX IF NOT EXISTS idx_email_logs_payment_id ON email_logs(payment_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);
CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON email_logs(created_at);
