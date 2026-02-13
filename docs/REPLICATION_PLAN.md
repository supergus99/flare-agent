# Replicating the existing STR app on Flare

Flare is positioned as a **general risk assessment** product (not STR-specific); all user-facing copy uses generic language.

This document maps the **existing** application (PHP + MySQL + filesystem; repo stays **untouched**) to the **Flare** stack (Workers + D1 + R2 + Queues + Pages). Use it as a step-by-step plan; implement in the **flare** repo only.

---

## 1. What the existing system does (reference only)

| Area | Existing tech | Main behaviour |
|------|----------------|----------------|
| **Routing** | PHP `index.php`, Apache/Nginx | Serves static HTML, `/admin`, `/backend`, Stripe webhook, payment-success, assessment, report-view |
| **Database** | MySQL (PDO) | contact_submissions, leads, payments, reports, report_versions, job_queue, admin_users, customers, automation_settings, email_logs, etc. |
| **Payments** | Stripe | Create Checkout Session, webhook `checkout.session.completed` → update payments, trigger welcome email / report flow |
| **Assessment** | PHP form handler | Multi-step form → store in contact_submissions (and link to payment/submission) |
| **Reports** | PHP + AI API | Generate report (AI) → write HTML to filesystem → store path in reports/report_versions; report-view serves by hash |
| **Email** | PHPMailer + SMTP | Welcome email, report delivery, reminders (config in automation_settings) |
| **Jobs** | MySQL job_queue + PHP worker | generate_report, send_welcome_email, send_approved_report |
| **Admin** | PHP sessions + pages | Dashboard, customers, submissions, reports, payments, settings; approve reports, send emails |

**Reference paths (read-only):**  
`website/backend/` (create-checkout-session.php, stripe-webhook.php, assessment-handler, report-generator, email-automation, admin/*),  
`website/backend/database/` (schema, migrations),  
`website/frontend/templates/` (assessment form, report template).

---

## 2. Feature → Flare mapping

| Feature | Flare implementation |
|---------|------------------------|
| **Stripe checkout** | Worker `POST /api/checkout` → create Stripe Checkout Session, return `url`; secrets: `STRIPE_SECRET_KEY` |
| **Stripe webhook** | Worker `POST /api/webhooks/stripe` → verify signature, on `checkout.session.completed` insert/update D1 payments, optionally send to Queue (welcome email / trigger report) |
| **Payment-success redirect** | Pages route or Worker route; read payment from D1 by session_id, show “success” and link to assessment or report |
| **Assessment form** | Pages: multi-step form (or single page); on submit → Worker `POST /api/assessments` → insert D1 contact_submissions (and link to payment_id if present); optionally queue `generate_report` |
| **Report generation** | Queue consumer (or Workflows): read job payload → call AI (OpenAI/Claude or Workers AI) → build HTML → `REPORTS.put(key, html)` in R2 → update D1 report_versions (html_path = R2 key), mark complete |
| **Report view (by hash)** | Worker `GET /report?hash=...` → lookup D1 (payments/reports by access_hash) → get R2 key → fetch from R2 → return HTML (or 404) |
| **Welcome / report email** | After payment or after report approved: Worker or Queue consumer → call email API (Resend/SendGrid); store from-address in D1 automation_settings or env |
| **Admin auth** | Worker: login route checks password hash against D1 admin_users; set HTTP-only cookie or JWT; middleware for admin routes |
| **Admin: dashboard** | Worker-rendered HTML or SPA that calls Worker `GET /api/admin/stats` (counts from D1) |
| **Admin: submissions/reports/payments** | Worker `GET /api/admin/submissions` etc. → query D1, return JSON or HTML |
| **Admin: approve report** | Worker `POST /api/admin/reports/:id/approve` → update D1, optionally queue `send_approved_report` |

---

## 3. Data: MySQL → D1 (SQLite)

Port schema from the existing repo into **flare** `migrations/` as SQLite-compatible SQL:

- **ENUM** → `TEXT` + CHECK or application logic.
- **AUTO_INCREMENT** → `INTEGER PRIMARY KEY AUTOINCREMENT`.
- **DATETIME / TIMESTAMP** → `TEXT` (ISO8601).
- **FOREIGN KEY** → SQLite supports them; add as needed.
- **LONGTEXT** → `TEXT`.

**Core tables to add (in order):**

1. **leads** – id, name, email, company, phone, service (TEXT), payment_id, created_at, etc.
2. **payments** – id, transaction_id, service_type (TEXT), amount, currency, customer_email, customer_name, access_token, access_hash, payment_status (TEXT), expires_at, created_at, etc.
3. **reports** – id, payment_id, submission_id, report_type, status, file_path (or r2_key), html_path, reviewed_by, sent_at, etc.
4. **report_versions** – id, report_id, version, status, html_path (R2 key), job_id, completed_at, etc.
5. **admin_users** – id, username, email, password_hash, is_active, created_at.
6. **automation_settings** – setting_key, setting_value, description.
7. **email_logs** – id, payment_id, email_type, recipient_email, status, sent_at.
8. **customers** (if used) – id, email, etc.
9. **job_queue** (optional; you can use Cloudflare Queues only) – or keep for audit.

Expand **contact_submissions** to match the existing columns (company, units, service, platforms, pms, payment, message, status, notes) as needed.

---

## 4. Phased implementation order

### Phase 1 – Payments and core data

1. **D1:** Add migrations for `leads`, `payments`, `automation_settings`, `admin_users` (minimal). Expand `contact_submissions` if needed.
2. **Worker:** `POST /api/checkout` – create Stripe Checkout Session (amount, product from request or config), return `{ url }`. Store Stripe session id or payment intent in D1 or cookie.
3. **Worker:** `POST /api/webhooks/stripe` – verify `Stripe-Signature`, on `checkout.session.completed` insert row in `payments`, set status completed; optionally enqueue `send_welcome_email`.
4. **Pages:** “Pricing” or “Checkout” button → call `POST /api/checkout`, redirect to returned URL.
5. **Pages or Worker:** “Payment success” page/route – read payment from D1 by session_id (or query param), show success and link to assessment or dashboard.

**Secrets:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (Worker secrets).

---

### Phase 2 – Assessment and report storage

1. **D1:** Add `reports`, `report_versions` (with `html_path` = R2 key).
2. **Pages:** Multi-step assessment form (copy structure from existing `assessment-full.html`); on submit → `POST /api/assessments` with JSON body.
3. **Worker:** `POST /api/assessments` – validate, insert into `contact_submissions` (and link to `payment_id` if present); optionally enqueue `generate_report` with submission_id/payment_id.
4. **Queue consumer:** On `generate_report` – load submission from D1, build prompt (from existing report template/instructions), call AI API (or Workers AI), build HTML, upload to R2, insert/update `reports` and `report_versions` in D1.
5. **Worker:** `GET /report?hash=...` – lookup by access_hash in payments/reports, get R2 key from report_versions, fetch object from R2, return HTML with correct headers.

**Secrets:** `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` (or use Workers AI).

---

### Phase 3 – Email and admin

1. **Email:** Choose provider (e.g. Resend). Worker or queue consumer calls provider API to send welcome email and “report ready” email. Store `from_email` / template ids in D1 `automation_settings` or env. **Secret:** `RESEND_API_KEY` (or equivalent).
2. **Admin login:** Worker `POST /api/admin/login` – check username/password against D1 `admin_users`, set cookie or return JWT. Protect admin routes with middleware that validates cookie/JWT.
3. **Admin:** Worker routes `GET /api/admin/submissions`, `GET /api/admin/payments`, `GET /api/admin/reports` – query D1, return JSON (or render simple HTML).
4. **Admin:** `POST /api/admin/reports/:id/approve` – update report status in D1, optionally enqueue `send_approved_report` (email with report link).

---

### Phase 4 – Polish and parity

- **Admin dashboard:** Aggregate counts from D1 (submissions, payments, reports pending).
- **Custom domain:** Attach domain to Pages and Worker (e.g. `flare.example.com` + `api.flare.example.com`).
- **Report template:** Port the existing HTML report template and AI instructions into the Queue consumer (or a Worker that builds the prompt).
- **Calendly / other integrations:** Add only if needed; replicate webhook handlers as Worker routes.

---

## 5. Where to look in the existing repo (read-only)

| Need | Path |
|------|------|
| Stripe checkout creation | `website/backend/create-checkout-session.php` |
| Stripe webhook handling | `website/backend/stripe-webhook.php` |
| Payment success flow | `website/backend/payment-success.php` |
| Assessment form structure | `website/frontend/templates/assessment-full.html` |
| Assessment submit handler | `website/backend/assessment-handler-enhanced.php` or similar |
| Report generation (AI + HTML) | `website/backend/report-generator.php`, `html-report-generator.php`, `ai_service.php` |
| Report template / prompt | `website/frontend/templates/report-templates/`, AI instructions in admin/settings |
| Report view by hash | `website/backend/report-view.php` |
| Email sending | `website/backend/email-automation.php`, PHPMailer usage in admin |
| Job queue usage | `website/backend/lib/job-queue.php`, `website/backend/jobs/process-job.php` |
| DB schema and migrations | `website/backend/database/database-setup-complete.sql`, `website/backend/database/migrations/` |
| Admin auth | `website/backend/admin/check-admin-login.php`, `includes/auth.php` |

---

## 6. Summary

- **Do not change** the existing PHP/MySQL repo; use it only as reference.
- **Implement only in Flare:** Worker routes, D1 migrations, R2 keys for report HTML, Queue messages, Pages forms.
- **Order:** Phase 1 (Stripe + D1 payments) → Phase 2 (assessment + report gen + R2 + report view) → Phase 3 (email + admin) → Phase 4 (dashboard, domain, template parity).

**Phase 1 is implemented:** D1 migration `002_phase1_payments.sql`, Worker routes `/api/checkout`, `/api/webhooks/stripe`, `/api/success`, Pages `checkout.html` and `success.html`, and SETUP.md Section 7.

**Phase 2 is implemented:** D1 migration `003_phase2_reports.sql` (reports, report_versions, expanded contact_submissions), Worker `POST /api/assessments`, `GET /report?hash=`, Queue consumer `generate_report` (stub HTML → R2), Pages `assessment.html` and success/report links. See SETUP.md Section 8.

**Phase 3 is implemented:** D1 migration `004_phase3_email_admin.sql` (email_logs), Resend for welcome + report-ready emails (queue `send_welcome_email`, `send_approved_report`), admin login (JWT + password hash with salt), GET admin submissions/payments/reports, POST approve report, Pages `admin.html`. See SETUP.md Section 9.

**Phase 4 is implemented:** GET /api/admin/stats (counts), admin UI dashboard with stat cards (Submissions, Payments, Reports, Pending review), improved report HTML template (sections, table), SETUP.md Section 10 (custom domain steps, report template note). Calendly/other integrations left for later.
