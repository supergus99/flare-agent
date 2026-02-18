# Flare – Setup Guide

Step-by-step setup: GitHub, CI/CD, D1, R2, Workers, Queues, Pages.

---

## 1. GitHub secrets (do first)

In your **flare** repo → **Settings** → **Secrets and variables** → **Actions**:

| Secret name | Value |
|-------------|--------|
| `CLOUDFLARE_API_TOKEN` | Your Cloudflare API token (Workers + D1 + R2 + Queues + Pages: Edit) |
| `CLOUDFLARE_ACCOUNT_ID` | From Cloudflare Dashboard → Workers & Pages → Account ID |

---

## 2. Deploy the Worker (CI)

After secrets are set, push to `main`:

```bash
cd ~/projects/flare
git add .
git commit -m "Add Worker and CI"
git push origin main
```

GitHub Actions will run and deploy **flare-worker** to Cloudflare. Check the **Actions** tab; when green, the Worker is live at `https://flare-worker.<your-subdomain>.workers.dev`.

---

## 3. D1 (database)

1. **Create the database** (from the flare repo, with Node/Wrangler installed):
   ```bash
   cd ~/projects/flare
   npx wrangler d1 create flare-db
   ```
   Copy the **database_id** from the output.

2. **Bind D1 to the Worker:** In `wrangler.toml`, uncomment the `[[d1_databases]]` block and replace `YOUR_D1_DATABASE_ID` with the id from step 1.

3. **Run the migration** (creates `contact_submissions` table):
   ```bash
   npx wrangler d1 execute flare-db --remote --file=./migrations/001_initial.sql
   ```

4. **Deploy:** Commit and push; CI will deploy with D1. Or run `npx wrangler deploy` locally.

5. **Test:** Open `https://flare-worker.<your-subdomain>.workers.dev/db` – you should see `{"d1":"ok","submissions_count":0}`.

---

## 4. R2 (object storage for reports)

1. **Create the bucket:** Cloudflare Dashboard → **Workers R2 Storage** → **Create bucket** → name: **flare-reports**, location Automatic, leave public access **off**.
2. **Binding** is already in `wrangler.toml` (`REPORTS` → `flare-reports`). Deploy (push to main or `npx wrangler deploy`).
3. **Test:** Open `https://flare-worker.gusmao-ricardo.workers.dev/r2` – you should see `{"r2":"ok","bucket":"flare-reports"}`.

---

## 5. Queues (flare-jobs)

1. **Create the queue:** Cloudflare Dashboard → **Workers & Pages** → **Queues** → **Create Queue** → name: **flare-jobs**. Create.
2. **Binding** is already in `wrangler.toml` (producer `JOBS` + consumer). Deploy (push to main or `npx wrangler deploy`).
3. **Test:** GET `https://flare-worker.gusmao-ricardo.workers.dev/queue` → `{"queue":"ok",...}`. POST to `/queue` (no body needed) to send a test message; the consumer will process it.

---

## 6. Pages (static site)

1. **Static files** are in the **`public/`** folder (`index.html`, `404.html`). Commit and push so the repo has them.

2. **Create the Pages project:** Cloudflare Dashboard → **Workers & Pages** → **Pages** → **Create project** → **Connect to Git**.

3. **Select the flare repo** (e.g. `supergus99/flare-agent`) and click **Begin setup**.

4. **Build settings:**
   - **Production branch:** `main`
   - **Framework preset:** None
   - **Build command:** leave **empty**
   - **Build output directory:** `public`

5. **Save and Deploy.** Pages will deploy the contents of `public/` on every push to `main`.

6. **URL:** You’ll get a URL like `https://flare-agent.pages.dev` (or the project name you chose). Open it to see the Flare landing page with links to the Worker endpoints.

---

## 7. Phase 1 – Stripe payments

1. **Run Phase 1 migration** (creates `payments`, `leads`, `automation_settings`, `admin_users`, `stripe_webhook_events`):
   ```bash
   npx wrangler d1 execute flare-db --remote --file=./migrations/002_phase1_payments.sql
   ```

2. **Worker secrets** (Dashboard → Workers & Pages → flare-worker → Settings → Variables and Secrets, or `wrangler secret put <NAME>`):
   - `STRIPE_SECRET_KEY` – Stripe secret key (sk_test_... or sk_live_...).
   - `STRIPE_WEBHOOK_SECRET` – Stripe webhook signing secret (whsec_...).

3. **Optional** (for correct redirects when Worker and Pages are on different hosts):
   - `SUCCESS_BASE_URL` – Your Pages URL (e.g. `https://flare-agent.pages.dev`). Used so the Worker redirects to your success page after payment.
   - `WORKER_PUBLIC_URL` – Your Worker URL (e.g. `https://flare-worker.gusmao-ricardo.workers.dev`). Used as Stripe Checkout `success_url` so Stripe redirects back to the Worker, which then redirects to `SUCCESS_BASE_URL/success.html?hash=...`.

3b. **Optional – Checkout branding** (if you use a Stripe sub-account and want Flare branding instead of the parent/STR logo):
   - `CHECKOUT_DISPLAY_NAME` – Business name shown at the top of Stripe Checkout (e.g. `Flare`).
   - `CHECKOUT_LOGO_URL` – Full HTTPS URL to your logo image (e.g. `https://getflare.net/logo.png`). Stripe recommends at least 128×128px, JPG or PNG, under 512KB.
   - You can also set branding in the **sub-account** Dashboard: [Settings → Branding](https://dashboard.stripe.com/settings/branding).

4. **Stripe webhook:** In [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks), add endpoint:
   - URL: `https://flare-worker.<your-subdomain>.workers.dev/api/webhooks/stripe`
   - Events: `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`
   - Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

5. **Flow:** User opens Pages → Checkout → chooses plan → POST to Worker `/api/checkout` → redirect to Stripe Checkout → after payment Stripe redirects to Worker `/api/success?session_id=...` → Worker writes/updates payment in D1 and redirects to `SUCCESS_BASE_URL/success.html?hash=...`.

---

## 8. Phase 2 – Assessment and reports

1. **Run Phase 2 migration** (expands `contact_submissions`, creates `reports`, `report_versions`):
   ```bash
   npx wrangler d1 execute flare-db --remote --file=./migrations/003_phase2_reports.sql
   ```
   Run once. If you see "duplicate column name", that migration was already applied; you can skip or run only the new table statements.

2. **Flow:**
   - After payment, user lands on `success.html?hash=...`. The page links to **Assessment** with the same `hash`.
   - User opens **Assessment** (`/assessment.html?hash=...`), fills company name, contact name, email, optional notes, and submits.
   - Worker **POST /api/assessments** saves to `contact_submissions` (and links to `payment_id` when `access_hash` is valid), then enqueues a **generate_report** job.
   - **Queue consumer** processes `generate_report`: creates a `reports` row (with `view_hash`), creates a `report_versions` row, builds a placeholder HTML report from submission data, uploads it to **R2** (`reports/{reportId}/v{version}.html`), and updates `report_versions` with `html_path` and status `draft`.
   - User can open **View your report** (link on success page): **GET** `https://flare-worker.<subdomain>.workers.dev/report?hash=...` (same payment `access_hash` or report `view_hash`). Worker looks up the report, fetches HTML from R2, and returns it.

3. **Report content:** Phase 2 uses a **stub** report (contact details + notes). To use AI-generated content later, add `OPENAI_API_KEY` or Workers AI and extend the queue consumer (see `handleGenerateReport` in `src/index.js`).

---

## 9. Phase 3 – Email and admin

1. **Run Phase 3 migration** (creates `email_logs`):
   ```bash
   npx wrangler d1 execute flare-db --remote --file=./migrations/004_phase3_email_admin.sql
   ```

2. **Resend (email):**
   - Sign up at [resend.com](https://resend.com), create an API key.
   - Worker secret: `RESEND_API_KEY` = your Resend API key (e.g. `re_...`).
   - Optional: `FROM_EMAIL`, `FROM_NAME` or set `from_email` / `from_name` in D1 `automation_settings` (migration 002 inserts defaults).
   - After payment, **Stripe calls your webhook** (`checkout.session.completed`). The Worker then sends the welcome email in that webhook request (no queue required). Ensure **RESEND_API_KEY** is set and the **Stripe webhook** is configured to point to your Worker URL (see RESEND_CONFIG.md). The email is logged to `email_logs`.
   - When you **approve** a report in Admin, the Worker enqueues **send_approved_report**; the consumer sends an email with the report view link and sets the report status to `sent`.

3. **Admin auth:**
   - Worker secrets: `ADMIN_JWT_SECRET` (random string, e.g. `openssl rand -hex 32`), `ADMIN_PASSWORD_SALT` (another random string).
   - Create the first admin user in D1: password is stored as **SHA-256(salt + password)** in hex. Example (Node): `node -e "const c=require('crypto'); const s='YOUR_SALT'; const p='your_password'; console.log(c.createHash('sha256').update(s+p).digest('hex'));"` then `INSERT INTO admin_users (username, email, password_hash, is_active) VALUES ('admin', 'you@example.com', '<hex_output>', 1);` (run via `wrangler d1 execute` or Dashboard).
   - **POST /api/admin/login** with `{ "username": "admin", "password": "your_password" }` returns `{ "token": "..." }`. Use the token in **Authorization: Bearer &lt;token&gt;** (or cookie `admin_token=...`) for admin routes.

4. **Admin routes (all require auth):**
   - **GET /api/admin/submissions** – list contact_submissions.
   - **GET /api/admin/payments** – list payments.
   - **GET /api/admin/reports** – list reports.
   - **POST /api/admin/reports/:id/approve** – set report status to `approved` and enqueue `send_approved_report`.

5. **Admin UI:** Open **/admin.html** on your Pages site. Sign in with your admin username and password; view submissions, payments, and reports; click **Approve & send email** on a report to send the report link to the customer.

---

## 10. Phase 4 – Dashboard and polish

1. **Admin dashboard:** The admin UI now shows a **stats bar** (Submissions, Payments, Reports, Pending review) at the top. The Worker exposes **GET /api/admin/stats** (auth required), which returns counts from D1. No extra setup.

2. **Custom domain (optional):**
   - **Pages:** Cloudflare Dashboard → Workers & Pages → your Pages project → **Custom domains** → Add (e.g. `flare.example.com`). Add the CNAME or A/AAAA records at your DNS provider as shown.
   - **Worker:** Workers & Pages → flare-worker → **Triggers** → **Custom Domains** → Add (e.g. `api.flare.example.com`). Then set **WORKER_PUBLIC_URL** and **SUCCESS_BASE_URL** to use these URLs so Stripe redirects and links point to your domain.

3. **Report template:** The generated report HTML (in the queue consumer) uses a structured template (Executive summary, Contact & plan, Your notes). To add AI-generated content, extend `handleGenerateReport` in `src/index.js`: call OpenAI or Workers AI with the submission data, then inject the result into the HTML before uploading to R2.

---

## 11. Phase 5 – Editable templates (admin)

1. **Run migration:** `npx wrangler d1 execute flare-db --remote --file=./migrations/005_templates.sql`  
   This creates `assessment_template` (one row with form config JSON) and `report_templates` (one row for the report HTML). The assessment form config is seeded with the current fields; the report template body is left empty (Worker uses the built-in template until you save one from admin).

2. **Admin → Templates tab:** After logging in, open the **Templates** tab. You can:
   - **Assessment form template:** Edit title, intro, hash warning, submit label, and each field’s label, type, required, placeholder. Field **names** (e.g. `company_name`, `contact_name`, `email`, `role`, `message`) must not be changed so submissions still map correctly.
   - **Report HTML template:** Edit the full HTML. Use placeholders `{{name}}`, `{{company}}`, `{{email}}`, `{{service}}`, `{{message}}`, `{{report_date}}`. If you clear and save, the Worker falls back to the built-in report HTML.

3. **Public API:** `GET /api/assessment-template` (no auth) returns the current assessment form config so the assessment page can render the form from it. The assessment page falls back to a default config if the request fails.
