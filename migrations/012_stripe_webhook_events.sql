-- Stripe webhook idempotency and error tracking (required for webhook handler).
-- Run if your D1 database was created without 002_phase1_payments.sql.
-- Safe to run multiple times (CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  livemode INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'received',
  attempts INTEGER NOT NULL DEFAULT 0,
  payment_intent_id TEXT,
  checkout_session_id TEXT,
  last_error TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stripe_events_status ON stripe_webhook_events(status, received_at);
CREATE INDEX IF NOT EXISTS idx_stripe_events_event_id ON stripe_webhook_events(event_id);
