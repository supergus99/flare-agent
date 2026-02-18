# Resend configuration checklist

**Email strategy:** The system uses **Resend only** (no other email service). The welcome email is sent **when Stripe sends `checkout.session.completed`**. If `payment_intent.succeeded` arrives first, the Worker stores the customer email in the **leads** table; when `checkout.session.completed` runs, it fills the payment from the session or from that lead, then sends the welcome email. See **[EMAIL_STRATEGY.md](EMAIL_STRATEGY.md)** for the full flow and requirements.

Use this page to verify Resend and webhook setup.

## 1. API key available to the Worker

- **Local (`wrangler dev`):** In the project root, create `.dev.vars` (copy from `.dev.vars.example`) and add:
  ```bash
  RESEND_API_KEY=re_xxxxxxxxxxxx
  ```
  Do not commit `.dev.vars` (it is gitignored).

- **Production (Cloudflare):** Set the secret on the Worker so it’s available as `env.RESEND_API_KEY`:
  - **Dashboard:** Workers & Pages → **flare-worker** → **Settings** → **Variables and Secrets** → **Encrypted** → Add `RESEND_API_KEY` with your Resend API key.
  - **CLI:** `npx wrangler secret put RESEND_API_KEY` and paste the key when prompted.

If the key is missing, the code never calls Resend (it returns early). The Admin “Send test email” (Settings → Email) will show **"RESEND_API_KEY is not set"** when the key is missing.

## 2. Test from Admin

1. Open **Admin** → **Settings** → **Email (Resend)**.
2. Enter your email and click **Send test email**.
3. If you see **"RESEND_API_KEY is not set"** → set the secret as above (and redeploy if needed).
4. If you see **"Sent"** but no email arrives → check Resend dashboard (logs, domain, from address).
5. If you see an error message (e.g. from Resend API) → fix that (e.g. verify domain, fix from address).

**Contact form:** To receive each website Contact form submission at a specific address (e.g. **mail@strsecure.com**), set **CONTACT_NOTIFY_EMAIL** to that address:
- **Production:** Cloudflare Dashboard → flare-worker → Settings → Variables and Secrets → **Encrypted** → Add `CONTACT_NOTIFY_EMAIL` = `mail@strsecure.com` (or CLI: `npx wrangler secret put CONTACT_NOTIFY_EMAIL`).
- **Local:** In `.dev.vars` add `CONTACT_NOTIFY_EMAIL=mail@strsecure.com`.
Then redeploy. In Admin → Settings → Email you’ll see “Configured: m***@strsecure.com” and can use **Send test to contact address** to verify. Each real submission is emailed there with Reply-To the sender. The **from** address (e.g. Flare &lt;noreply@getflare.net&gt;) must use a domain verified in Resend, or Resend may reject the send.

## 3. “From” address and domain

- Default “from” is **Flare &lt;noreply@getflare.net&gt;** (from code or `automation_settings`).
- In Resend you must either:
  - **Verify the domain** (e.g. getflare.net) and use an address on that domain, or
  - Use Resend’s test sender (e.g. **onboarding@resend.dev**) for testing only.

To override: set Worker secret **FROM_EMAIL** (e.g. `Flare <noreply@yourdomain.com>`) or set `from_email` in D1 table `automation_settings`.

## 5. When the welcome email is sent (no “exposed” API needed)

- **Stripe sends a webhook** to your Worker when checkout completes (`checkout.session.completed`). The Worker creates/updates the payment (filling email from the session or from the **leads** table when `payment_intent.succeeded` had arrived first), then **sends the welcome email** in that same request. The customer does not need to hit any URL for the email to be sent.
- **You must configure the webhook in Stripe:** [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks) → Add endpoint → URL: **`https://<your-worker-url>/api/webhooks/stripe`** (e.g. `https://flare-worker.xxx.workers.dev/api/webhooks/stripe`). Select **`checkout.session.completed`** (required for the welcome email) and **`payment_intent.succeeded`** (so the Worker can store the email in **leads** when it arrives first). Copy the signing secret and set the Worker secret **STRIPE_WEBHOOK_SECRET** to that value.
- If the webhook is not configured or the URL is wrong, Stripe never calls your Worker and the welcome email is never sent. The success page redirect is only for showing the user a “Thank you” page; it does not trigger the email.
- If the welcome email still doesn’t arrive, check **email_logs** in D1 for that payment: `email_type = 'welcome'`, `status = 'failed'` and **error_message** (e.g. Resend “from domain not verified”).

## 6. Check logs

- **Resend dashboard:** [resend.com/emails](https://resend.com/emails) – see sent/failed and error messages.
- **App:** Table **email_logs** (e.g. via Admin or D1) – `email_type = 'welcome'`, `status = 'sent'` or `'failed'`, `error_message` if failed.

If there is no row in **email_logs** for that payment, the send path was never run (e.g. key missing or payment/email checks not met). If there is a row with `status = 'failed'`, use **error_message** and Resend logs to fix the cause.

## D1 shows activity but no email in Resend

If you see **webhook_received** rows in **email_logs** (or events in **stripe_webhook_events**) but the welcome email does **not** appear in the Resend dashboard:

1. **Find the payment** for your test (e.g. latest row in **payments** or match by **transaction_id** / **checkout_session_id** from **stripe_webhook_events**).
2. **In email_logs**, look for a row with that **payment_id** and **email_type = 'welcome'**.
   - **No welcome row** → The send path didn’t run for this payment (e.g. no `customer_email` yet, or event was processed as **idempotent** – the email was sent on the first delivery; check Resend for the time of the first webhook).
   - **status = 'sent'** → Resend accepted the request. Check the Resend dashboard for that **recipient_email** and **sent_at** time; ensure you’re in the correct Resend project and time range.
   - **status = 'failed'** → **error_message** contains the reason (e.g. “from domain not verified”, invalid API key). Fix that in Resend or env and retry with a new payment.
3. **Idempotency:** Stripe may deliver the same event more than once. We process only the first time; later deliveries are skipped. So the “last test” might be a retry – the email was sent on the first delivery. Check **stripe_webhook_events**: if **attempts** > 1 for that event, the send happened on the first attempt.
