-- Clean all rows in tables that have foreign keys (and related tables), in FK-safe order.
-- Keeps: automation_settings, assessment_template, report_templates, admin_users.
-- Run: npx wrangler d1 execute flare-db --remote --file=./migrations/014_clean_foreign_key_data.sql

-- Children first (tables that reference others)
DELETE FROM email_logs;
DELETE FROM report_versions;
DELETE FROM reports;
DELETE FROM contact_submissions;

-- Break payments ↔ leads cycle, then delete
UPDATE payments SET lead_id = NULL;
DELETE FROM leads;
DELETE FROM payments;

-- No FKs but transactional/audit data you may want to reset
DELETE FROM stripe_webhook_events;
DELETE FROM rate_limit_assessment;
