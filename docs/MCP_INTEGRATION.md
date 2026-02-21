# MCP integration with main Flare app

When the main Flare Worker has **MCP_SERVICE_URL** set, each **assessment submission** (POST /api/assessments) that is saved to D1 also triggers the MCP enrichment pipeline.

## Flow

1. User submits the assessment form (main Flare app).
2. Flare Worker saves the submission to D1 and enqueues the existing **generate_report** job (Flare report).
3. If **MCP_SERVICE_URL** is set, the Worker builds an MCP payload from the submission and assessment data and calls **POST {MCP_SERVICE_URL}/enrich-assessment** (fire-and-forget via `ctx.waitUntil`).
4. MCP service runs: domain scan → NVD → industry context → financial model → template fill → store report in R2 → send report email via Resend → store metadata in KV. MCP JSON is not persisted.

So after a submission, the user can receive:
- The **Flare report** (from the existing queue job, when approved/sent).
- The **MCP report** email (from the MCP service, sent automatically when the pipeline finishes).

## Configuration

- **Main app (flare-worker):** Set **MCP_SERVICE_URL** to your MCP Worker URL.
  - In **wrangler.toml** (project root): `[vars]` → `MCP_SERVICE_URL = "https://mcp-service.xxx.workers.dev"`.
  - Or in Cloudflare Dashboard: Workers & Pages → flare-worker → Settings → Variables and Secrets → Add **MCP_SERVICE_URL** (plain or secret).
  - Or for local dev: in **.dev.vars** add `MCP_SERVICE_URL=https://mcp-service.xxx.workers.dev`.
- If **MCP_SERVICE_URL** is empty or unset, the main app does not call MCP.

## Payload mapping (Flare → MCP)

| MCP field           | Flare source                                      |
|---------------------|---------------------------------------------------|
| submission_id       | D1 contact_submissions.id                         |
| domain              | assessment website_url (hostname) or email domain |
| industry             | assessment industry                              |
| employee_count      | assessment number_of_people (parsed to number)     |
| revenue_range       | assessment budget_range                          |
| uses_wordpress      | assessment website_platform === "WordPress"        |
| uses_m365           | assessment email_provider contains Microsoft/365  |
| controls.mfa         | assessment mfa_email (Yes → true)                 |
| controls.backup      | assessment backup_method present                 |
| controls.endpoint_protection | assessment computer_protection present   |
| user_email          | submission email                                 |

If **domain** cannot be derived (no website URL and no @ in email), the main app does not call MCP.

## Testing

1. Deploy the main Flare Worker with **MCP_SERVICE_URL** set.
2. Submit an assessment that includes at least a **website URL** or an email with a domain (e.g. user@company.com).
3. Check the inbox for the MCP report email (from Resend, subject includes the domain).
4. In MCP KV (REPORT_META), the key is the **submission_id** (Flare contact_submissions.id); value is report metadata (report_url, generated_at, etc.).

## Optional: report_status in D1

The current integration does not write a `report_status` (e.g. pending/failed) back to D1. To add that, you would need either:
- A webhook from MCP to the main app when the report is ready or failed, or
- The main app to poll MCP KV (from another Worker or cron) and update a column on contact_submissions.
