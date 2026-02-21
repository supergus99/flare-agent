# MCP Enrichment Service – MVP

Edge-first, serverless MCP pipeline for SMB risk reports: **domain/SSL/email checks**, **NVD CVE feed**, **industry stats**, **financial model** → template → (optional AI) → **HTML/PDF** → **email**.  
**Minimal storage:** only submission ID + report metadata in KV; **MCP JSON is never stored.**

## Stack

- **Cloudflare Worker** – HTTP `POST /enrich-assessment` + **Queue consumer**
- **Workers Queues** – async: enrich → store report → send email
- **R2** – report HTML (and optional PDF) storage
- **KV** – report metadata only (`submission_id` → `{ pdf_url, report_url, report_text, generated_at }`)
- **Resend** (or SMTP API) – email delivery

## Project layout

```
mcp_service/
├── workers/
│   ├── main.js            # Entry: fetch + queue consumer
│   ├── orchestrator.js    # MCP pipeline
│   ├── domain_scan.js    # DNS / SSL / SPF-DMARC-DKIM
│   ├── vuln_intel.js     # NVD feed (KV cache), WPScan-style keywords
│   ├── industry_context.js
│   ├── financial_model.js
│   ├── template_filler.js
│   ├── template-report.js # Inlined HTML template
│   ├── ai_enricher.js     # Optional OpenAI/Anthropic
│   ├── pdf_worker.js      # R2 store; optional PDF service
│   ├── email_sender.js    # Resend
│   └── models.js          # AssessmentPayload, parse
├── wrangler.toml
├── package.json
└── README.md
```

## Step-by-step setup & deploy

Follow these in order. All commands assume you are in the project root; use `cd mcp_service` when a step says “from `mcp_service/`”.

---

### Step 1 – Install dependencies

From the repo root:

```bash
cd mcp_service
npm install
```

---

### Step 2 – Log in to Cloudflare (if needed)

Check if you’re already logged in:

```bash
npx wrangler whoami
```

If you see “Not logged in” or an error, run:

```bash
npx wrangler login
```

(These are two separate commands: run `whoami` first; only run `login` if you need to sign in.)

---

### Step 3 – Create KV namespace for report metadata

```bash
npx wrangler kv namespace create REPORT_META
```

You’ll see output like:

```text
Add the following to your wrangler.toml:
[[kv_namespaces]]
binding = "REPORT_META"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

1. Open `mcp_service/wrangler.toml`.
2. Find the first `[[kv_namespaces]]` block (binding `REPORT_META`).
3. Replace `REPLACE_WITH_KV_NAMESPACE_ID` with the `id` value from the command output (the long hex string).

---

### Step 4 – (Optional) Create KV namespace for NVD cache

```bash
npx wrangler kv namespace create NVD_CACHE
```

1. In `wrangler.toml`, find the second `[[kv_namespaces]]` block (binding `NVD_CACHE`).
2. Replace `REPLACE_WITH_NVD_CACHE_KV_ID` with the returned `id`.

If you prefer not to use NVD cache, you can remove the entire `NVD_CACHE` `[[kv_namespaces]]` block from `wrangler.toml` (the worker will still call NVD; it just won’t cache).

---

### Step 5 – Create R2 bucket

1. Open [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages**.
2. In the left sidebar, click **R2 Object Storage**.
3. Click **Create bucket**.
4. Bucket name: **mcp-reports** (must match `bucket_name` in `wrangler.toml`).
5. Click **Create bucket**.

---

### Step 6 – Create Queue

1. In the dashboard: **Workers & Pages** → **Queues** (left sidebar).
2. Click **Create queue**.
3. Queue name: **mcp-jobs** (must match `queue` in `wrangler.toml`).
4. Click **Create queue**.

---

### Step 7 – Set secrets (production)

From `mcp_service/`:

**Required (email):**

```bash
npx wrangler secret put RESEND_API_KEY
```

Paste your Resend API key when prompted (e.g. `re_xxxx...` from [resend.com/api-keys](https://resend.com/api-keys)).

**Optional:**

```bash
npx wrangler secret put OPENAI_API_KEY      # optional – AI enrichment
npx wrangler secret put ANTHROPIC_API_KEY  # optional – AI enrichment (alternative)
npx wrangler secret put FROM_EMAIL        # optional – e.g. "Flare <noreply@getflare.net>"
npx wrangler secret put PDF_SERVICE_URL   # optional – URL that accepts HTML and returns PDF
```

---

### Step 8 – Local dev secrets (`.dev.vars`)

From `mcp_service/`:

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` and add at least:

```bash
RESEND_API_KEY=re_xxxxxxxxxxxx
```

Optional for local testing:

```bash
FROM_EMAIL=Flare <noreply@getflare.net>
OPENAI_API_KEY=sk-...
```

Do **not** commit `.dev.vars` (it is gitignored).

---

### Step 9 – Deploy the worker

From `mcp_service/`:

```bash
npx wrangler deploy
```

Note the worker URL (e.g. `https://mcp-service.<your-subdomain>.workers.dev`).

---

### Step 10 – Test the endpoint

**Local:**

```bash
cd mcp_service
npx wrangler dev
```

In another terminal:

```bash
curl -X POST http://localhost:8787/enrich-assessment \
  -H "Content-Type: application/json" \
  -d '{
    "submission_id": "test-001",
    "domain": "example.com",
    "industry": "Legal",
    "employee_count": 10,
    "revenue_range": "100k-500k",
    "uses_wordpress": false,
    "uses_m365": true,
    "controls": { "mfa": true, "backup": true, "endpoint_protection": false },
    "user_email": "your-email@example.com"
  }'
```

You should get **202** and JSON: `{"message":"Submission received, report generating.","submission_id":"test-001"}`. Check your inbox for the report email (and Resend dashboard if it doesn’t arrive).

**Production:**

Replace the URL with your deployed worker URL:

```bash
curl -X POST https://mcp-service.<your-subdomain>.workers.dev/enrich-assessment \
  -H "Content-Type: application/json" \
  -d '{"submission_id":"prod-001","domain":"example.com","industry":"Legal","employee_count":10,"revenue_range":"100k-500k","uses_wordpress":false,"uses_m365":true,"controls":{"mfa":true,"backup":true,"endpoint_protection":false},"user_email":"you@example.com"}'
```

---

### Step 11 – (Optional) Verify report metadata in KV

From `mcp_service/`, use the **namespace ID** you copied in Step 3 (the hex string for `REPORT_META`):

```bash
npx wrangler kv key get "test-001" --namespace-id=YOUR_REPORT_META_NAMESPACE_ID
```

Replace `YOUR_REPORT_META_NAMESPACE_ID` with that ID, and use the same `submission_id` you sent (e.g. `test-001`). You should see JSON with `report_url`, `generated_at`, and optionally `pdf_url`. MCP JSON will not be in KV.

---

### Troubleshooting

| Issue | What to check |
|-------|----------------|
| 503 "Queue not configured" | Queue name in dashboard is **mcp-jobs** and `wrangler.toml` has `[[queues.producers]]` and `[[queues.consumers]]` with `queue = "mcp-jobs"`. |
| No email | Resend API key set (secret or `.dev.vars`), and Resend “from” domain verified. See [RESEND_CONFIG.md](../docs/RESEND_CONFIG.md) for your main app. |
| R2 errors | Bucket **mcp-reports** exists and `[[r2_buckets]]` in `wrangler.toml` has `bucket_name = "mcp-reports"`. |
| KV errors | REPORT_META namespace ID in `wrangler.toml` matches the one from `wrangler kv namespace create REPORT_META`. |
| Queue runs but no report | Check Worker logs in dashboard (Workers & Pages → mcp-service → Logs). |

---

## Setup (summary)

1. **KV:** Create `REPORT_META` (required), optionally `NVD_CACHE`; put IDs in `wrangler.toml`.
2. **R2:** Create bucket `mcp-reports` in dashboard.
3. **Queue:** Create queue `mcp-jobs` in dashboard.
4. **Secrets:** `RESEND_API_KEY` required; optionally `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `FROM_EMAIL`, `PDF_SERVICE_URL`.
5. **Local:** Copy `.dev.vars.example` to `.dev.vars` and add `RESEND_API_KEY`.

## API

### `POST /enrich-assessment`

**Body (AssessmentPayload):**

```json
{
  "submission_id": "sub_abc123",
  "domain": "example.com",
  "industry": "Legal",
  "employee_count": 15,
  "revenue_range": "500k-1M",
  "uses_wordpress": true,
  "uses_m365": true,
  "controls": { "mfa": true, "backup": false, "endpoint_protection": true },
  "user_email": "contact@example.com"
}
```

**Response (202):**

```json
{
  "message": "Submission received, report generating.",
  "submission_id": "sub_abc123"
}
```

The worker enqueues a job. The **queue consumer** runs the full pipeline (domain scan, NVD, industry, financial, template fill, optional AI), stores the report in R2, sends the email, and writes only **report metadata** to KV. **MCP JSON is discarded** after use.

## Flow

1. **User** → `POST /enrich-assessment` with payload.
2. **Worker** → Validates payload, pushes to queue, returns 202.
3. **Queue consumer** →  
   `domain_scan` → `vuln_intel` (NVD) → `industry_context` → `financial_model` →  
   `template_filler` → (optional) `ai_enricher` →  
   `pdf_worker` (store HTML in R2; optional PDF if `PDF_SERVICE_URL` set) →  
   `email_sender` (Resend) →  
   KV put `submission_id` → `{ pdf_url, report_url, report_text, generated_at }`.
4. **MCP JSON** – used only in memory; never persisted.

## Local dev

```bash
cd mcp_service
npm install
cp .dev.vars.example .dev.vars   # add RESEND_API_KEY, etc.
npx wrangler dev
```

Then:

```bash
curl -X POST http://localhost:8787/enrich-assessment \
  -H "Content-Type: application/json" \
  -d '{"submission_id":"test1","domain":"example.com","industry":"Legal","employee_count":10,"revenue_range":"100k-500k","uses_wordpress":false,"uses_m365":true,"controls":{"mfa":true,"backup":true,"endpoint_protection":false},"user_email":"you@example.com"}'
```

## Deploy

```bash
cd mcp_service
npx wrangler deploy
```

## Report template

The report uses an inlined HTML template in `workers/template-report.js` with placeholders filled from MCP + payload, e.g. `{{domain}}`, `{{submission_id}}`, `{{overall_risk_score}}`, `{{risk_level}}`, `{{ssl_status}}`, `{{risk_flags}}`, `{{vulnerability_summary}}`, `{{industry_risk_level}}`, `{{annualized_risk_exposure}}`, `{{control_gap_summary}}`. You can replace the template string with your own (e.g. from `public/templates/assessment-full.html`-style) and keep the same placeholder names.

## PDF generation

- **Without `PDF_SERVICE_URL`:** Only HTML is stored in R2; the link in the email points to the HTML report (or you can serve it via a custom domain + R2 public access / Worker).
- **With `PDF_SERVICE_URL`:** Point this to a service (or your own Pages Function) that accepts `POST` with HTML body and returns `application/pdf`. The Worker uploads that PDF to R2 and can attach or link the PDF in the email.

## Integration with main Flare app

The main Flare Worker (project root) can trigger MCP automatically on each assessment submission. Set **MCP_SERVICE_URL** in the main app’s `wrangler.toml` (or as a secret / in `.dev.vars`) to your MCP Worker URL, e.g.:

```toml
[vars]
MCP_SERVICE_URL = "https://mcp-service.gusmao-ricardo.workers.dev"
```

After that, when a user submits the assessment form, the main app will call **POST {MCP_SERVICE_URL}/enrich-assessment** with a payload built from the submission and assessment data. The MCP report is then generated and emailed asynchronously. See **[../docs/MCP_INTEGRATION.md](../docs/MCP_INTEGRATION.md)** for mapping and testing.

## Free tools used

- **DNS / SSL / Email:** Cloudflare DNS over HTTPS (1.1.1.1), HTTPS fetch for SSL, TXT for SPF/DMARC.
- **Vulnerabilities:** NVD 2.0 API (optional KV cache).
- **Industry:** Static SMB stats (Verizon/Hiscox/ENISA style) keyed by industry.
- **Email:** Resend API.
