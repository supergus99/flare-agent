-- Set default "from" address for automated emails to noreply@getflare.net
-- Run once: npx wrangler d1 execute flare-db --remote --file=./migrations/009_from_email_getflare.sql

UPDATE automation_settings SET setting_value = 'Flare <noreply@getflare.net>' WHERE setting_key = 'from_email';

-- If no row exists yet (e.g. automation_settings was created without the default insert), insert one
INSERT OR IGNORE INTO automation_settings (setting_key, setting_value, description, updated_at)
VALUES ('from_email', 'Flare <noreply@getflare.net>', 'From email for automated emails (welcome, report ready)', datetime('now'));
