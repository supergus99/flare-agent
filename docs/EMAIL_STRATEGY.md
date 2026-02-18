# Email strategy – reliability and flow

## Principle

- **Single provider:** The system uses **Resend** only. There is no other email service or paid SMTP. All transactional emails (welcome after payment, contact form notifications, report ready, admin test) go through the Resend API.
- **Welcome email is triggered only by `payment_intent.succeeded`.** When Stripe sends **`payment_intent.succeeded`** to your Worker, the Worker sends the welcome email in that request. No other webhook event (e.g. `checkout.session.completed`) sends the email. The customer does not need to open any link; the success page is only for showing “Thank you”.
- **Admin “Send test email”** uses the same Resend API key. If that works, the webhook uses the same key and the same “from” address.

## Flow (welcome email)

1. Customer completes payment on Stripe Checkout.
2. Stripe may send **`checkout.session.completed`** first: the Worker creates/updates the payment in D1 and backfills `customer_email` from the session (so the payment is ready when **`payment_intent.succeeded`** runs).
3. Stripe sends **`payment_intent.succeeded`** to your Worker:  
   `https://<your-worker-url>/api/webhooks/stripe`  
   **Only this event triggers the welcome email.**
4. Worker receives `payment_intent.succeeded`, verifies the signature with `STRIPE_WEBHOOK_SECRET`, then:
   - Looks up the payment in D1 by `transaction_id` (PaymentIntent id).
   - If the payment has `customer_email` and status completed, sends the welcome email via **Resend** (same API as the admin test).
   - Records the outcome in `email_logs` (status `sent` or `failed`, and `error_message` if failed).
   - If the send failed, stores the reason in `stripe_webhook_events.last_error` for that event.
5. Worker responds `200` to Stripe. The customer is redirected to the success page separately; that page does **not** trigger the email.

## How to find the Stripe webhook URL

The URL Stripe must call is: **your Worker’s base URL** + **`/api/webhooks/stripe`** (no trailing slash).

**Option A – Cloudflare Dashboard**

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages**.
2. Click your Worker (**flare-worker**).
3. In the right-hand panel you’ll see the Worker URL, e.g. `https://flare-worker.&lt;your-subdomain&gt;.workers.dev`.
4. Your webhook URL is that + `/api/webhooks/stripe`, e.g.  
   `https://flare-worker.gusmao-ricardo.workers.dev/api/webhooks/stripe`

**Option B – You set WORKER_PUBLIC_URL**

If you configured the secret **WORKER_PUBLIC_URL** (e.g. `https://api.getflare.net`), use that exact value + `/api/webhooks/stripe`:  
`https://api.getflare.net/api/webhooks/stripe`

**Check it**

Open the URL in a browser (GET). You should see a short text message. That’s the URL to paste into Stripe Dashboard → Webhooks → Endpoint URL.

## D1 table required

The webhook handler expects a **stripe_webhook_events** table in D1 (for idempotency and storing `last_error` when the welcome email fails). If your database doesn’t have it, run:

```bash
npx wrangler d1 execute flare-db --remote --file=./migrations/012_stripe_webhook_events.sql
```

(Use `--local` instead of `--remote` for local D1.)

## What you must configure

| Requirement | Where |
|------------|--------|
| **Resend API key** | Worker secret `RESEND_API_KEY`. Same key used by Admin test and by the webhook. |
| **Stripe webhook** | [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks): add endpoint URL `https://<worker-host>/api/webhooks/stripe`. Enable **`payment_intent.succeeded`** (required for welcome email) and **`checkout.session.completed`** (so the payment row is created/updated with customer email). Copy the signing secret. |
| **Stripe webhook secret** | Worker secret `STRIPE_WEBHOOK_SECRET` = the signing secret from the webhook endpoint. |
| **“From” address** | Resend requires the “from” domain to be verified. Set `FROM_EMAIL` (e.g. `Flare <noreply@yourdomain.com>`) or use the default and verify that domain in Resend. |

If the webhook URL or secret is wrong, Stripe never calls your Worker (or verification fails), and no welcome email is sent. The success page does not send the email.

## No rows in email_logs / email not in Resend?

The Worker sends the welcome email **only** when it processes **payment_intent.succeeded**. On that event it will create or update the payment from Stripe (using `receipt_email` or `metadata.customer_email` from the PaymentIntent) if the payment was missing or had no email—so the email can be sent even if **payment_intent.succeeded** arrives before **checkout.session.completed**. It writes to **email_logs** for that event. If you see events in **stripe_webhook_events** but no welcome in **email_logs** or no send in Resend:

1. **Check event_type** in **stripe_webhook_events**: the welcome email runs **only for `payment_intent.succeeded`**. If you only have **checkout.session.completed**, add **payment_intent.succeeded** in [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks) → your endpoint → Events to send. Keep **checkout.session.completed** so the payment row (and customer_email) exists before the email is sent.
2. **Redeploy** the Worker so the latest code is live.
3. If the payment had no email, the Worker fetches the PaymentIntent from Stripe and uses **receipt_email** or **metadata.customer_email**. Your Checkout already sets `payment_intent_data.metadata.customer_email` when creating the session; Stripe also sets **receipt_email** from the customer’s checkout form.
4. Run another test payment and check **email_logs** again; you should see at least one row per payment (status **sent** or **failed** with **error_message**).

## No events in stripe_webhook_events?

If payments appear in Admin but **stripe_webhook_events** is empty, Stripe is **not** calling your Worker. Those payments were created when the customer hit the success page (`/api/success`); the webhook never ran, so no welcome email was sent from the webhook.

**Fix:** In [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks): add (or edit) an endpoint whose **URL** is exactly your Worker URL, e.g. `https://flare-worker.<your-subdomain>.workers.dev/api/webhooks/stripe`. Enable **`payment_intent.succeeded`** (required for the welcome email) and **`checkout.session.completed`** (so the payment is created with customer email). Copy the **Signing secret** and set the Worker secret **STRIPE_WEBHOOK_SECRET** to that value. Open the URL in a browser (GET) to confirm it is reachable; Stripe will POST to the same URL when events occur.

## Checking failures

- **Resend:** [resend.com/emails](https://resend.com/emails) – see each send and any error.
- **Your app:** Table `email_logs` – `email_type = 'welcome'`, `status = 'failed'`, `error_message` (e.g. “from domain not verified”).
- **Webhook events:** Table `stripe_webhook_events` – `last_error` is set when the welcome send failed (e.g. “RESEND_API_KEY not set”, “no customer email”, or the Resend error message).

## Summary

- **Email = Resend only.**  
- **Welcome email = sent only when Stripe sends `payment_intent.succeeded`.**  
- **Reliability = correct webhook URL + `STRIPE_WEBHOOK_SECRET` + `RESEND_API_KEY` + verified “from” domain.**
