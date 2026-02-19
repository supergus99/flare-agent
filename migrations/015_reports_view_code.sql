-- Add security code for report view (sent in report-ready email). Optional: run 014_clean_foreign_key_data.sql first if you want a clean slate.
-- Run: npx wrangler d1 execute flare-db --remote --file=./migrations/015_reports_view_code.sql

ALTER TABLE reports ADD COLUMN view_code TEXT;
