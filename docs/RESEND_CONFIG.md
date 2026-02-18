# Resend configuration checklist

Use this to verify why welcome emails might not be sent or not appear in Resend.

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

## 3. “From” address and domain

- Default “from” is **Flare &lt;noreply@getflare.net&gt;** (from code or `automation_settings`).
- In Resend you must either:
  - **Verify the domain** (e.g. getflare.net) and use an address on that domain, or
  - Use Resend’s test sender (e.g. **onboarding@resend.dev**) for testing only.

To override: set Worker secret **FROM_EMAIL** (e.g. `Flare <noreply@yourdomain.com>`) or set `from_email` in D1 table `automation_settings`.

## 4. When the welcome email is sent

- After Stripe **checkout.session.completed** (webhook), or when the user lands on **/api/success**.
- If the **queue** (`flare-jobs`) is configured, the email is sent by the queue consumer; otherwise it’s sent inline. In both cases **RESEND_API_KEY** must be set.

## 5. Check logs

- **Resend dashboard:** [resend.com/emails](https://resend.com/emails) – see sent/failed and error messages.
- **App:** Table **email_logs** (e.g. via Admin or D1) – `email_type = 'welcome'`, `status = 'sent'` or `'failed'`, `error_message` if failed.

If there is no row in **email_logs** for that payment, the send path was never run (e.g. key missing or payment/email checks not met). If there is a row with `status = 'failed'`, use **error_message** and Resend logs to fix the cause.
