-- Store customer-chosen language at checkout (assessment, emails, report).
-- Run: npx wrangler d1 execute flare-db --remote --file=./migrations/011_add_customer_locale.sql

ALTER TABLE payments ADD COLUMN customer_locale TEXT;
