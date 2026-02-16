-- Reset all test/assessment data (payments, submissions, reports, email logs, rate limits).
-- Keeps: automation_settings, assessment_template, report_templates, admin_users.
-- Run once when you want a clean slate: npx wrangler d1 execute flare-db --remote --file=./migrations/010_reset_tests_clear_data.sql

-- Order: delete child tables first, then parents (reports → contact_submissions, email_logs → payments).
DELETE FROM reports;
DELETE FROM contact_submissions;
DELETE FROM email_logs;
DELETE FROM payments;
DELETE FROM rate_limit_assessment;

-- Optional: uncomment to also clear Stripe webhook event log and leads (if your schema has them)
-- DELETE FROM stripe_webhook_events;
-- DELETE FROM leads;
