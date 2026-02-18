# Email strategy – reliability and flow

## Principle

- **Single provider:** The system uses **Resend** only. There is no other email service or paid SMTP. All transactional emails (welcome after payment, contact form notifications, report ready, admin test) go through the Resend API.
- **Welcome email is triggered only by the Stripe webhook.** When Stripe sends `checkout.session.completed` to your Worker, the Worker creates/updates the payment and sends the welcome email in the same request. The customer does not need to open any link; the success page is only for showing “Thank you”.
- **Admin “Send test email”** uses the same Resend API key. If that works, the webhook uses the same key and the same “from” address.

## Flow (welcome email)

1. Customer completes payment on Stripe Checkout.
2. Stripe sends a **webhook** `POST` to your Worker:  
   `https://<your-worker-url>/api/webhooks/stripe`  
   with event type `checkout.session.completed`.
3. Worker receives the event, verifies the signature with `STRIPE_WEBHOOK_SECRET`, then:
   - Creates or updates the payment in D1 (using session + PaymentIntent).
   - Ensures the payment has `customer_email` (from Stripe session).
   - Sends the welcome email via **Resend** (same API as the admin test).
   - Records the outcome in `email_logs` (status `sent` or `failed`, and `error_message` if failed).
   - If the send failed, stores the reason in `stripe_webhook_events.last_error` for that event.
4. Worker responds `200` to Stripe. The customer is redirected to the success page separately; that page does **not** trigger the email.

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
| **Stripe webhook** | [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks): add endpoint URL `https://<worker-host>/api/webhooks/stripe`, event **checkout.session.completed**. Copy the signing secret. |
| **Stripe webhook secret** | Worker secret `STRIPE_WEBHOOK_SECRET` = the signing secret from the webhook endpoint. |
| **“From” address** | Resend requires the “from” domain to be verified. Set `FROM_EMAIL` (e.g. `Flare <noreply@yourdomain.com>`) or use the default and verify that domain in Resend. |

If the webhook URL or secret is wrong, Stripe never calls your Worker (or verification fails), and no welcome email is sent. The success page does not send the email.

## No events in stripe_webhook_events?

If payments appear in Admin but **stripe_webhook_events** is empty, Stripe is **not** calling your Worker. Those payments were created when the customer hit the success page (`/api/success`); the webhook never ran, so no welcome email was sent from the webhook.

**Fix:** In [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks): add (or edit) an endpoint whose **URL** is exactly your Worker URL, e.g. `https://flare-worker.<your-subdomain>.workers.dev/api/webhooks/stripe`. Enable the event **checkout.session.completed**. Copy the **Signing secret** and set the Worker secret **STRIPE_WEBHOOK_SECRET** to that value. Open the URL in a browser (GET) to confirm it is reachable; Stripe will POST to the same URL when events occur.

## Checking failures

- **Resend:** [resend.com/emails](https://resend.com/emails) – see each send and any error.
- **Your app:** Table `email_logs` – `email_type = 'welcome'`, `status = 'failed'`, `error_message` (e.g. “from domain not verified”).
- **Webhook events:** Table `stripe_webhook_events` – `last_error` is set when the welcome send failed (e.g. “RESEND_API_KEY not set”, “no customer email”, or the Resend error message).

## Summary

- **Email = Resend only.**  
- **Welcome email = sent only from the Stripe webhook.**  
- **Reliability = correct webhook URL + `STRIPE_WEBHOOK_SECRET` + `RESEND_API_KEY` + verified “from” domain.**
