-- Verification code for assessment access + rate limit for assessment submissions
-- Run: npx wrangler d1 execute flare-db --remote --file=./migrations/007_verification_code_and_rate_limit.sql
-- Note: Existing payments will have NULL verification_code (assessment still works without code for them).

-- Add verification_code to payments (6-char code sent in welcome email; required to access assessment)
ALTER TABLE payments ADD COLUMN verification_code TEXT;

-- Rate limit: key = ip or access_hash, count per window (e.g. 10 per 15 min per IP for /api/assessments)
CREATE TABLE IF NOT EXISTS rate_limit_assessment (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL
);
