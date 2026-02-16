-- One assessment submission per payment (per customer purchase).
-- Run once: npx wrangler d1 execute flare-db --remote --file=./migrations/008_one_submission_per_payment.sql
--
-- Partial unique index: only one contact_submissions row per payment_id when payment_id is set.
-- Submissions without a payment (guest/contact form) are unchanged. Concurrent INSERTs with
-- the same payment_id will cause one to fail with UNIQUE constraint; API catches and returns friendly message.

CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_submissions_payment_id_unique
  ON contact_submissions(payment_id) WHERE payment_id IS NOT NULL;
