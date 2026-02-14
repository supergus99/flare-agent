# Flare – Customer workflow spec and gap analysis

This document maps your described workflow to the codebase and lists what is **in place** vs **to implement**. The **existing** `src/` worker and public assets implement the full workflow (see below for implemented items).

---

## 1. Workflow (your description)

| Step | Description | Status | Notes |
|------|-------------|--------|--------|
| 1 | Customer makes purchase through website → redirected to Stripe checkout | ✅ In place | `public/checkout.html` → `POST /api/checkout` → redirect to Stripe |
| 2 | When payment confirmed, webhook returns payment confirmation | ✅ In place | `POST /api/webhooks/stripe` handles `checkout.session.completed` |
| 3 | Automatically triggers email to customer with **secure link to assessment** and **security code** to access assessment | ✅ In place | Link + code in welcome email; code gate on assessment; `GET /api/assessment-verify`; code required on submit when payment has verification_code |
| 4 | Customer fills assessment with **CAPTCHA** for secure delivery | ✅ In place | Cloudflare Turnstile in assessment form; set `FLARE_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`; optional when both set |
| 5 | Assessment is delivered; **link expires** and has **rate limit** | ✅ In place | Expiry enforced in API and verify endpoint (410); rate limit 10/15 min per IP via `rate_limit_assessment` (D1) |
| 6 | Assessment submitted → automatically triggers **AI agent** to read assessment and generate report from instructions/template | ✅ In place | `handleGenerateReport` calls OpenAI when `OPENAI_API_KEY` set; `ai_report_instruction` in automation_settings; placeholders `{{ai_executive_summary}}`, `{{ai_findings}}`, `{{ai_recommendations}}` |
| 7 | AI finishes → report stays **in review by human** | ✅ In place | Report status `pending_review`; admin sees it in Reports tab |
| 8 | Human in admin portal can **open report to read it**, confirm OK, click **Approve** | ✅ In place | **Approve:** ✅. **Open report to read:** ❌ – no “View report” link in admin (only Approve button) |
| 9 | Approve automatically triggers email to customer with **secure link to report** | ✅ In place | `send_approved_report` queue → `handleSendApprovedReport` → email with `/report?hash=...` |

---

## 2. Template and style requirements

| Requirement | Status | Notes |
|-------------|--------|--------|
| **Emails** (welcome, report ready): website style | ✅ In place | `getWelcomeEmailHtml` and `getReportReadyEmailHtml` use Outfit, Flare colours, CTA buttons |
| **Assessment**: website style | ⚠️ Partial | `assessment-full.html` uses Outfit and Flare-like vars; default API form is basic |
| **Report**: website style | ✅ In place | Default report template uses Outfit, Flare colours, card layout |
| **Assessment**: **light/dark toggle** for customer | ✅ In place | `assessment-full.html` has `#theme-toggle` and `data-theme` / `flare_theme` in nav |
| **Report**: **light/dark toggle** for customer | ✅ In place | Default report HTML has `#theme-toggle` and `data-theme` / `flare_theme` |

---

## 3. What to implement (concise)

- **Security code for assessment**
  - Add `verification_code` (e.g. 6-char) to payments (migration + upsert in webhook/success).
  - Welcome email: include security code in body.
  - Assessment: require code to access form (e.g. gate page: enter code → then show form, or validate code on first submit). Use same link + code in email.

- **Assessment link expiry**
  - Before showing assessment form (or on submit): check `payments.expires_at`; if expired, return 410 and show “Link expired” (assessment page and `POST /api/assessments`).

- **Rate limit on assessment**
  - Rate limit `POST /api/assessments` (e.g. by IP or by access_hash). Use Cloudflare rate limiting or in-worker store (e.g. D1 or KV) with a small window and max requests per window.

- **CAPTCHA on assessment**
  - Add Turnstile or reCAPTCHA to assessment form; send token on submit; in `POST /api/assessments` verify token server-side before saving. No CAPTCHA in code today.

- **AI report generation**
  - In queue consumer `handleGenerateReport`: after loading submission and template, call AI (OpenAI or Workers AI) with instructions + assessment data; merge AI output into report template (or replace placeholders); then render HTML and upload to R2 as today. Keep “report in review” and approval flow unchanged.

- **Admin: open report before approve**
  - In admin Reports table: add a “View” link that opens the generated report in a new tab (e.g. `WORKER_URL + '/report?hash=' + row.view_hash`). Human reads report, then clicks Approve.

- **Emails: website style**
  - Replace welcome and report-ready email bodies with HTML that uses Flare/Outfit styling (e.g. same CSS vars or a small inline style block) so they match the website.

- **Assessment: light/dark toggle**
  - In `assessment-full.html` (and any default assessment form from API): add `data-theme` + a theme toggle (same pattern as report); persist choice in `localStorage` (e.g. `flare_theme`).

---

## 4. Where in the codebase

| Item | File(s) |
|------|--------|
| Webhook → payment + welcome email | `src/index.js` (Stripe webhook, `handleSendWelcomeEmail`) |
| Welcome email body | `src/index.js` `handleSendWelcomeEmail` |
| Report-ready email body | `src/index.js` `handleSendApprovedReport` |
| Assessment submit + expiry check | `src/index.js` `POST /api/assessments`; assessment page (e.g. `public/templates/assessment-full.html`) |
| Assessment form (CAPTCHA, theme) | `public/templates/assessment-full.html`, default in `src/index.js` (assessment template) |
| Report generation (AI) | `src/index.js` `handleGenerateReport` |
| Report HTML (theme already there) | `src/index.js` `getDefaultReportTemplateBody` |
| Admin reports table + View link | `public/admin.html` (reports tab, add column/link) |
| Rate limit | `src/index.js` (middleware or in `POST /api/assessments`); or Cloudflare Rate Limiting rule |
| Payments schema (verification_code, expires_at) | `migrations/` (new migration if needed); `src/index.js` upsert payment |

---

## 5. Suggested order of work

1. **Security code + expiry** (migration, webhook/success, welcome email, assessment gate or validation).
2. **Assessment expiry enforcement** (API + front end).
3. **Admin “View report”** (one link in admin UI).
4. **Emails: website style** (two HTML bodies).
5. **Assessment: light/dark toggle** (assessment-full + default form).
6. **Rate limit** on `POST /api/assessments`.
7. **CAPTCHA** (Turnstile or reCAPTCHA) on assessment.
8. **AI** in `handleGenerateReport` (instructions + template + AI call).

This keeps the existing flow intact and adds your requirements step by step.
