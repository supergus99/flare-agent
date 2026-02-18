-- Link leads to Stripe PaymentIntent so checkout.session.completed can fill payment email from lead when payment_intent.succeeded arrived first.
-- Run: npx wrangler d1 execute flare-db --remote --file=./migrations/013_leads_stripe_payment_intent_id.sql

ALTER TABLE leads ADD COLUMN stripe_payment_intent_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_stripe_payment_intent_id ON leads(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
