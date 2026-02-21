# MCP integration with main Flare app

MCP enrichment is **merged into the single Flare report**. When **MCP_SERVICE_URL** is set, the Flare report generation (queue consumer) calls the MCP **sync** endpoint, gets domain/vuln/industry/financial/control-gap data, and merges it into the Flare HTML template. There is no separate MCP email; the customer receives one report (after admin approval) that includes an "MCP Risk Enrichment" section.

## Flow (merged report)

1. User submits the assessment form (main Flare app).
2. Flare Worker saves the submission to D1 and enqueues **generate_report** (Flare report).
3. Queue consumer runs **handleGenerateReport**: loads submission and assessment data, builds report vars, then **calls MCP sync** (`POST {MCP_SERVICE_URL}/enrich-assessment/sync`) with the same payload shape. MCP runs the pipeline (domain scan, NVD, industry, financial, control gaps) and returns **MCP JSON only** (no email, no R2/KV write).
4. Flare merges MCP data into template vars (`mcp_domain_risk`, `mcp_vuln_summary`, `mcp_industry_context`, `mcp_financial_exposure`, `mcp_control_gaps`, etc.) and renders the **single** Flare HTML report (including section "2.5) MCP Risk Enrichment").
5. Report is stored in Flare R2; status remains **pending_review**.
6. Admin approves → **send_approved_report** → customer receives one email with the link to the (enriched) Flare report.

If the MCP sync call fails, the report is still generated with fallback text ("—" or "Enrichment unavailable") for the MCP section.

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

## Optional: PDF download

The report is stored as HTML in Flare R2. To offer a **PDF download**:

- Use a serverless PDF generator (e.g. a Cloudflare Pages Function with Puppeteer, or an external API that accepts HTML and returns PDF). Generate the PDF when the report is approved (or on-demand when the user clicks "Download PDF").
- Store the PDF in R2 (e.g. `reports/{reportId}/v{version}.pdf`) and set **pdf_download_link** in the report-ready email, or add a "Download PDF" link in the report HTML (template var `{{pdf_download_link}}` – set in reportVars when you have a PDF URL).

## Optional: report_status in D1

The current integration does not write a `report_status` (e.g. pending/failed) back to D1. To add that, you would need either:
- A webhook from MCP to the main app when the report is ready or failed, or
- The main app to poll MCP KV (from another Worker or cron) and update a column on contact_submissions.
