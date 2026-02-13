-- Add optional HTML body to assessment_template (full-page HTML instead of form_config only)
-- Run: npx wrangler d1 execute flare-db --remote --file=./migrations/006_assessment_template_body.sql

ALTER TABLE assessment_template ADD COLUMN body TEXT;
