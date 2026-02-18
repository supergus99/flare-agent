-- Reset all test/assessment data (payments, submissions, reports, email logs, rate limits).
-- Keeps: automation_settings, assessment_template, report_templates, admin_users.
-- Run once when you want a clean slate: npx wrangler d1 execute flare-db --remote --file=./migrations/010_reset_tests_clear_data.sql

-- Order: delete child tables first to respect foreign keys.
DELETE FROM email_logs;
DELETE FROM report_versions;
DELETE FROM reports;
DELETE FROM contact_submissions;
UPDATE payments SET lead_id = NULL;
DELETE FROM leads;
DELETE FROM payments;
DELETE FROM stripe_webhook_events;
DELETE FROM rate_limit_assessment;
