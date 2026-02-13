-- Create report_templates if missing (e.g. D1 had only assessment_template from an older 005)
-- Run: npx wrangler d1 execute flare-db --remote --file=./migrations/005b_report_templates_only.sql

CREATE TABLE IF NOT EXISTS report_templates (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'default',
  body TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO report_templates (id, name, body, updated_at) VALUES (1, 'default', NULL, datetime('now'));
