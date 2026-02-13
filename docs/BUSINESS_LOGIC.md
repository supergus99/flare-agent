# Flare business logic (aligned with STR)

This document confirms that Flare implements the same customer cycle as STR: **purchase → assessment sent → customer fills and delivers → report generated**. Assessment and report templates are **private** (admin-only) and drive the flow.

---

## 1. Templates are private

- **Assessment template**  
  Stored in D1 (`assessment_template.body` and `assessment_template.form_config`). Editable only in **Admin → Templates → Assessment HTML template**. The public assessment page loads content from `GET /api/assessment-template` (no auth): if a custom HTML template is saved, the API returns `{ html: body }` and the page renders it; otherwise it returns form config for the default short form.

- **Report template**  
  Stored in D1 (`report_templates.body`). Editable only in **Admin → Templates → Report HTML template**. When a report is generated, the Worker uses the saved template if present, otherwise the built-in default. The template is never exposed publicly; only the generated report HTML is served (via view hash).

So: **assessment and report are private templates**, edited in admin and used internally.

---

## 2. Customer cycle (same as STR)

### Step 1: Customer purchases

- Checkout posts to Worker; Worker creates Stripe Checkout Session and redirects to Stripe.
- On success, Stripe redirects to `success.html?hash=<access_hash>`.
- Stripe webhook `payment_intent.succeeded` is handled: payment row is updated to `payment_status = 'completed'`, `access_hash` is set (or kept).
- **Queue:** `send_welcome_email` job is sent with `payment_id` (only for new payments).

**Code:** `src/index.js` (Stripe webhook) → `upsertPaymentFromIntent`; then `env.JOBS.send({ type: "send_welcome_email", payment_id: result.row.id })`.

---

### Step 2: Assessment is sent (welcome email)

- Queue consumer runs `handleSendWelcomeEmail(env, body)`.
- Loads payment by `payment_id`; gets `customer_email`, `customer_name`, `access_hash`.
- Builds **assessment link:** `{SUCCESS_BASE_URL}/assessment.html?hash={access_hash}`.
- Sends welcome email via Resend: “Thanks for your purchase. Complete your assessment to receive your report:” + assessment link.

So: **after purchase, the customer receives an email with the assessment link** (including their private `access_hash`).

**Code:** `handleSendWelcomeEmail` → Resend with `assessmentUrl = base + "/assessment.html?hash=" + access_hash`.

---

### Step 3: Customer fills assessment and delivers

- Customer opens the assessment link (e.g. `https://yoursite.com/assessment.html?hash=...`).
- Assessment page loads:
  - Calls `GET /api/assessment-template`.
  - If API returns `data.html`, the page replaces itself with that HTML (custom template from admin).
  - Otherwise it renders the default form from `data` (form_config).
- Customer fills the form (with or without hash; hash links the submission to the payment).
- On submit, frontend POSTs to `POST /api/assessments` with:
  - `access_hash` (from URL or hidden field),
  - `contact_name`, `company_name`, `email`, `role`, `message` (e.g. describe_concerns),
  - `assessment_data` (full form payload, including all sections).
- Worker:
  - Resolves payment from `access_hash` (or `payment_id` if provided).
  - Inserts into `contact_submissions` (name, email, company, service, message, **assessment_data**, payment_id, etc.).
  - **Queue:** sends `generate_report` job with `submission_id` and `payment_id` (when payment is known).

So: **customer fills and delivers the assessment; submission is stored and report generation is queued** (when there is a payment).

**Code:** `POST /api/assessments` → INSERT into `contact_submissions` → `env.JOBS.send({ type: "generate_report", submission_id, payment_id })`.

---

### Step 4: Report is generated (template + placeholders; AI optional)

- Queue consumer runs `handleGenerateReport(env, body)`.
- Loads **submission** (name, email, company, message, **assessment_data**) and ensures a **report** row (creates one if needed with status `pending_review`).
- **Report template (private):**
  - Reads saved template from `report_templates` (id 1) if `body` is not empty.
  - Otherwise uses built-in default template (`getDefaultReportTemplateBody()`).
- Builds **vars** from submission + parsed `assessment_data` (e.g. `name`, `company`, `email`, `role`, `message`, `report_date`, `units_range`, `countries`, `website_url`, …).
- **Renders report HTML:** `applyReportTemplate(templateBody, reportVars)` (replaces `{{name}}`, `{{company}}`, etc.).
- Uploads the HTML to R2 and writes a new row in `report_versions` (status `draft`).
- Report stays in status **`pending_review`**.

So: **report is generated from the private report template + submission/assessment data**. Today this is **template-only** (no AI). The same flow supports adding AI later (e.g. in the queue consumer: call an AI API to fill findings/recommendations, then merge into the template or replace placeholders).

**Code:** `handleGenerateReport` → `report_templates` or default → `buildReportVars(submission, data)` → `applyReportTemplate` → R2 put + `report_versions` update.

---

### Step 5: Admin approves report; customer receives report link

- In **Admin → Reports**, reports with status `pending_review` (or `approved`) show an “Approve” action.
- On Approve, Worker updates report status to `approved` and **Queue:** sends `send_approved_report` with `report_id`.
- Queue consumer runs `handleSendApprovedReport`: loads report (and payment/submission for recipient email), builds report URL (`/report?hash={view_hash}`), sends “Your security assessment report is ready” email via Resend, updates report status to `sent`.

So: **admin approval triggers the “report ready” email to the customer** with the private view link.

**Code:** `POST /api/admin/reports/:id/approve` → `env.JOBS.send({ type: "send_approved_report", report_id })` → `handleSendApprovedReport`.

---

## 3. Summary table

| Step | What happens | Where |
|------|----------------|--------|
| 1. Purchase | Payment completed; `access_hash` set; welcome email job queued | Stripe webhook → `send_welcome_email` |
| 2. Assessment sent | Welcome email with assessment link `.../assessment.html?hash=...` | `handleSendWelcomeEmail` |
| 3. Customer fills & delivers | Form submitted to `POST /api/assessments`; submission stored; `generate_report` queued | Assessment page → Worker → queue |
| 4. Report generated | Private report template + submission/assessment_data → HTML; stored in R2; report `pending_review` | `handleGenerateReport` (template-only; AI can be added here) |
| 5. Admin approves | Report approved → “Report ready” email with view link sent | Admin → `send_approved_report` → `handleSendApprovedReport` |

---

## 4. AI and report generation

- **Currently:** Report HTML is produced only from the **private report template** and **placeholders** filled from submission + `assessment_data` (e.g. `{{name}}`, `{{company}}`, `{{message}}`, `{{report_date}}`, …). No AI is called.
- **To match STR “AI generates the report”:** In the queue consumer, inside or after `handleGenerateReport`, add a step that:
  - Takes submission + `assessment_data` (+ optional report template sections),
  - Calls your AI API (e.g. OpenAI, Workers AI) to produce findings, risk levels, recommendations, etc.,
  - Then either:
    - Feeds AI output into a larger set of template vars and runs `applyReportTemplate` again, or
    - Builds the final HTML from the template and AI output in another way.

So: **the same business logic (templates private, same cycle) is implemented in Flare; the only difference from STR is that report generation is template-based by default, with AI to be plugged in at the same place (report generation step).**
