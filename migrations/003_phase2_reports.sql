-- Phase 2: Assessment + reports (SQLite for D1)
-- Run once: npx wrangler d1 execute flare-db --remote --file=./migrations/003_phase2_reports.sql
-- If a column already exists, that statement will fail; run remaining statements or re-run after fixing.

-- Expand contact_submissions for assessment data
ALTER TABLE contact_submissions ADD COLUMN company TEXT;
ALTER TABLE contact_submissions ADD COLUMN units TEXT;
ALTER TABLE contact_submissions ADD COLUMN service TEXT;
ALTER TABLE contact_submissions ADD COLUMN platforms TEXT;
ALTER TABLE contact_submissions ADD COLUMN pms TEXT;
ALTER TABLE contact_submissions ADD COLUMN payment TEXT;
ALTER TABLE contact_submissions ADD COLUMN message TEXT;
ALTER TABLE contact_submissions ADD COLUMN payment_id INTEGER;
ALTER TABLE contact_submissions ADD COLUMN assessment_data TEXT;
ALTER TABLE contact_submissions ADD COLUMN form_version TEXT;

CREATE INDEX IF NOT EXISTS idx_contact_submissions_payment_id ON contact_submissions(payment_id);

-- Reports: one per payment/submission; view_hash for secure link
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL,
  submission_id INTEGER,
  report_type TEXT NOT NULL DEFAULT 'initial',
  status TEXT NOT NULL DEFAULT 'pending_review',
  view_hash TEXT UNIQUE,
  view_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (payment_id) REFERENCES payments(id),
  FOREIGN KEY (submission_id) REFERENCES contact_submissions(id)
);
CREATE INDEX IF NOT EXISTS idx_reports_payment_id ON reports(payment_id);
CREATE INDEX IF NOT EXISTS idx_reports_submission_id ON reports(submission_id);
CREATE INDEX IF NOT EXISTS idx_reports_view_hash ON reports(view_hash);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

-- Report versions: generated HTML stored in R2; html_path = R2 object key
CREATE TABLE IF NOT EXISTS report_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  html_path TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  UNIQUE(report_id, version),
  FOREIGN KEY (report_id) REFERENCES reports(id)
);
CREATE INDEX IF NOT EXISTS idx_report_versions_report_id ON report_versions(report_id);
CREATE INDEX IF NOT EXISTS idx_report_versions_status ON report_versions(report_id, status);
