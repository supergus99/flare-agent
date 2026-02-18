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

## What you must configure

| Requirement | Where |
|------------|--------|
| **Resend API key** | Worker secret `RESEND_API_KEY`. Same key used by Admin test and by the webhook. |
| **Stripe webhook** | [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks): add endpoint URL `https://<worker-host>/api/webhooks/stripe`, event **checkout.session.completed**. Copy the signing secret. |
| **Stripe webhook secret** | Worker secret `STRIPE_WEBHOOK_SECRET` = the signing secret from the webhook endpoint. |
| **“From” address** | Resend requires the “from” domain to be verified. Set `FROM_EMAIL` (e.g. `Flare <noreply@yourdomain.com>`) or use the default and verify that domain in Resend. |

If the webhook URL or secret is wrong, Stripe never calls your Worker (or verification fails), and no welcome email is sent. The success page does not send the email.

## Checking failures

- **Resend:** [resend.com/emails](https://resend.com/emails) – see each send and any error.
- **Your app:** Table `email_logs` – `email_type = 'welcome'`, `status = 'failed'`, `error_message` (e.g. “from domain not verified”).
- **Webhook events:** Table `stripe_webhook_events` – `last_error` is set when the welcome send failed (e.g. “RESEND_API_KEY not set”, “no customer email”, or the Resend error message).

## Summary

- **Email = Resend only.**  
- **Welcome email = sent only from the Stripe webhook.**  
- **Reliability = correct webhook URL + `STRIPE_WEBHOOK_SECRET` + `RESEND_API_KEY` + verified “from” domain.**
