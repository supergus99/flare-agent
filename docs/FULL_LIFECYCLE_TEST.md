# Full customer/system lifecycle test

You can run the entire flow from **purchase → assessment → report** as a real user. Use **Stripe test mode** so no real charge is made.

---

## Prerequisites

- **Flare Worker** deployed (with D1, R2, Queues, Stripe, Resend, MCP_SERVICE_URL).
- **MCP Worker** deployed (for report enrichment).
- **Stripe** in **test mode** (test keys in Worker secrets).
- **Stripe webhook** pointing to `https://YOUR_FLARE_WORKER_URL/api/webhooks/stripe` with events `checkout.session.completed` and `payment_intent.succeeded`.
- **Resend** configured (from address verified); welcome and report-ready emails will be sent.
- **Admin** access to approve the report (or use Admin API).

**Base URL:** Your public site (e.g. `https://getflare.net` or `https://flare-worker.gusmao-ricardo.workers.dev` if you serve static from the Worker). Replace `YOUR_BASE_URL` below with that.

---

## Step 1 — Start checkout

1. Open **YOUR_BASE_URL** (e.g. homepage).
2. Click **Get your report** / **Get your Flare Compass** (or go directly to **YOUR_BASE_URL/checkout.html**).
3. On the checkout page, enter:
   - **Email:** an inbox you can access (e.g. your real email or a test address).
   - **Name** (optional), **Company** (optional), **Language**, **Currency** (e.g. EUR).
4. Click **Continue to payment**. You are redirected to **Stripe Checkout**.

---

## Step 2 — Complete payment (test card)

1. On Stripe’s payment page, use a **test card**:
   - **Card number:** `4242 4242 4242 4242`
   - **Expiry:** any future date (e.g. 12/34)
   - **CVC:** any 3 digits
   - **ZIP:** any
2. Complete payment. Stripe redirects to your **success** page.

---

## Step 3 — Reach the assessment

After payment you are redirected to:

**YOUR_BASE_URL/success.html?hash=ACCESS_HASH**

- You will receive a **welcome email** with the assessment link (check spam if it doesn’t arrive).
- **Or** copy the **hash** from the success page URL and open the assessment manually:
  - **YOUR_BASE_URL/assessment.html?hash=PASTE_HASH_HERE**

If the assessment page asks for a **security code**, use the **6-character code** from the welcome email.

---

## Step 4 — Fill and submit the assessment

1. Fill the assessment form. For **MCP enrichment** to run, use at least one of:
   - A **website URL** (e.g. `https://example.com`), or
   - An **email** that contains a domain (e.g. `you@company.com`).
2. Use the **same email** as at checkout (so the submission is linked to the payment).
3. Submit the form. You should see a success message and “Your report will be generated shortly.”

---

## Step 5 — Report generation (automatic)

- The **Flare queue** runs **generate_report**: loads your submission, calls **MCP sync** (domain, vuln, industry, financial), merges data into the report, optionally calls **Claude** for narrative, then saves the HTML to R2. Report status is **pending_review**.
- No action needed; wait a short time (usually under a minute). If something fails, check Worker logs and queue consumer logs in the Cloudflare dashboard.

---

## Step 6 — Admin approves the report

1. Log in to **Admin** (YOUR_BASE_URL/admin.html or your admin URL).
2. Open **Reports** (or the section that lists reports).
3. Find the new report (status **pending_review**).
4. Click **Approve** (or equivalent). This:
   - Sets report status to **approved**
   - Enqueues **send_approved_report**
   - Queue consumer sends the **“Your report is ready”** email with the report link.

---

## Step 7 — Open the report (customer)

1. Check the inbox for the **report-ready** email (same address as at checkout).
2. Click the **report link** in the email (e.g. YOUR_BASE_URL/report?hash=VIEW_HASH or similar).
3. If prompted, enter the **security code** from that email.
4. The **single Flare report** opens (HTML from R2), including:
   - Executive summary (and AI findings/recommendations if Claude is configured)
   - **Section 2.5) MCP Risk Enrichment** (domain risk, vuln summary, industry context, financial exposure, control gaps)
   - Rest of the Flare Compass content

---

## Checklist (full lifecycle)

| Step | What you do | What the system does |
|------|-------------|----------------------|
| 1 | Go to checkout, enter email/name | — |
| 2 | Pay with test card 4242… | Stripe → webhook → Flare creates payment, sends welcome email (or sends when you hit success page) |
| 3 | Open assessment (from email or success URL + hash) | — |
| 4 | Fill assessment (with domain or domain in email), submit | Flare saves to D1, enqueues generate_report |
| 5 | Wait | Queue: handleGenerateReport → MCP sync → merge → Claude (if set) → save HTML to R2 |
| 6 | Admin: Approve report | Flare enqueues send_approved_report → queue sends report-ready email |
| 7 | Click report link in email | Flare serves report HTML from R2 |

---

## Troubleshooting

- **No welcome email:** Check Resend dashboard and Worker logs; ensure Stripe webhook is configured and Flare receives `checkout.session.completed`. The success page also triggers the welcome email if it wasn’t sent by the webhook.
- **Assessment link invalid or expired:** Use the link from the email, or the hash from success.html?hash=... (link expires per `payments.expires_at`, often 30 days).
- **Report never appears in Admin:** Ensure the queue consumer ran (check Workers dashboard → flare-worker → Logs). Ensure D1 has the submission and payment linked.
- **No MCP section in report:** Ensure MCP_SERVICE_URL is set on the Flare Worker and MCP Worker is deployed; MCP sync is called during handleGenerateReport. If sync fails, the report still generates with “—” or “Enrichment unavailable” in section 2.5.
- **No AI (Claude) in report:** Configure Claude API key in Admin → Automation (or set CLAUDE_API_KEY / ANTHROPIC_API_KEY). AI fills executive summary, findings, and recommendations; MCP data is passed to Claude when present.

---

## “Fill with test data” and saved templates

The assessment form can be served from the **static file** `templates/assessment-full.html` or from a **custom template saved in Admin** (Admin → Templates → Assessment HTML). The “Fill with test data” logic is **inlined** so it works without any extra request:

- **Worker:** When serving a saved template, the Worker injects the full fill script (inline) before `</body>` if the template has the Fill button but not the fill script. No dependency on `/js/fill-test-data.js`. Redeploy the Worker after changes.
- **Static file:** `public/templates/assessment-full.html` includes the same fill script inline, so the fallback (when the API is not used) also works.

If you still see “Please refresh the page…”, do a hard refresh (Ctrl+Shift+R / Cmd+Shift+R) and ensure the Worker is redeployed. The file `public/js/fill-test-data.js` exists for reference only and is not required for the button to work.

---

## Enabling captcha for production

During testing, the assessment form does **not** load Cloudflare Turnstile (no captcha), so you can use “Fill with test data” and submit without blockers. For production security:

1. **Worker:** Set the secret `TURNSTILE_SECRET_KEY` (from Cloudflare Turnstile dashboard).
2. **Assessment page:** Before the assessment template runs, set:
   - `window.FLARE_CAPTCHA_ENABLED = true`
   - `window.FLARE_TURNSTILE_SITE_KEY = 'your-site-key'`
   (e.g. in a script tag or in the HTML that loads the assessment, or inject via your deployment.)
3. The Turnstile widget will then load on the form and the Worker will verify the token when both the secret and a token are present.

Leave `FLARE_CAPTCHA_ENABLED` unset (or false) and do not set `TURNSTILE_SECRET_KEY` until you are ready to require captcha.

---

## Optional: test without paying (dev only)

If you need to test **assessment → report** without going through Stripe:

1. Create a payment and submission in D1 manually (or via a test script), with a valid `access_hash` and `payment_id` linked to a submission.
2. Or call **POST /api/assessments** with a valid **access_hash** (from an existing test payment) and full assessment payload; then in Admin, find the report for that payment and approve it.

For a full lifecycle including payment and emails, use the steps above with Stripe test mode.
