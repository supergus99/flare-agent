-- Phase 5: Editable assessment and report templates (admin)
-- Run: npx wrangler d1 execute flare-db --remote --file=./migrations/005_templates.sql

-- Single row: form config JSON (title, intro, fields with name, label, type, required, placeholder, order)
CREATE TABLE IF NOT EXISTS assessment_template (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  form_config TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Default: current assessment form (same questions/sections, no style change)
INSERT OR IGNORE INTO assessment_template (id, form_config, updated_at) VALUES (
  1,
  '{"title":"Security assessment","intro":"Complete this form so we can generate your report. If you paid via Stripe, use the link from your confirmation email (it includes your secure access code).","hashWarning":"No access code in the URL. If you have a link from your payment confirmation, use that. You can still submit without a code; your submission will be saved but not linked to a payment.","submitLabel":"Submit assessment","fields":[{"name":"company_name","label":"Company name *","type":"text","required":true,"placeholder":"Your company","order":1},{"name":"contact_name","label":"Your name *","type":"text","required":true,"placeholder":"Full name","order":2},{"name":"email","label":"Email *","type":"email","required":true,"placeholder":"you@example.com","order":3},{"name":"role","label":"Role (optional)","type":"text","required":false,"placeholder":"e.g. Operations Manager","order":4},{"name":"message","label":"Additional notes (optional)","type":"textarea","required":false,"placeholder":"Any specific concerns or context...","order":5}]}',
  datetime('now')
);

-- Report template: HTML body with placeholders {{name}}, {{company}}, {{email}}, {{service}}, {{message}}, {{report_date}}
CREATE TABLE IF NOT EXISTS report_templates (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'default',
  body TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- No default body: Worker uses built-in buildStubReportHtml until admin saves a custom template
INSERT OR IGNORE INTO report_templates (id, name, body, updated_at) VALUES (1, 'default', NULL, datetime('now'));
