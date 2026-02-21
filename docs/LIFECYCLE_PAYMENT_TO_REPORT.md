# Full lifecycle: customer payment → report(s) received

This document describes the end-to-end flow from payment to the customer receiving the **Flare report** (after admin approval), which includes **MCP enrichment** (domain, vuln, industry, financial) merged into a single report.

**To run the full flow yourself:** see **[Full lifecycle test](FULL_LIFECYCLE_TEST.md)** for step-by-step instructions (Stripe test mode, assessment, approval, report link).

---

## High-level flow

```mermaid
flowchart TB
    subgraph Customer
        A[Customer pays on Stripe]
        B[Receives welcome email with assessment link]
        C[Opens assessment page, fills form]
        D[Submits assessment]
        E1[Receives MCP report email]
        E2[Receives Flare report-ready email]
    end

    subgraph Stripe
        A --> |checkout.session.completed| F
    end

    subgraph Flare["Flare Worker"]
        F[Webhook: create/update payment]
        G[Queue: send_welcome_email]
        H[POST /api/assessments: save submission to D1]
        I[Queue: generate_report]
        J[Trigger MCP: POST /enrich-assessment]
        K[Admin approves report]
        L[Queue: send_approved_report]
    end

    subgraph FlareQueue["Flare Queue Consumer"]
        M[handleSendWelcomeEmail]
        N[handleGenerateReport]
        O[handleSendApprovedReport]
    end

    subgraph MCP["MCP Worker"]
        P[POST /enrich-assessment: enqueue job]
        Q[Queue consumer: orchestrator]
    end

    subgraph MCPPipeline["MCP pipeline (async)"]
        R[domain_scan]
        S[vuln_intel]
        T[industry_context]
        U[financial_model]
        V[template_filler]
        W[Store HTML in R2]
        X[Send report email via Resend]
        Y[Store metadata in KV]
    end

    subgraph Resend["Resend"]
        Z1[Welcome email]
        Z2[MCP report email]
        Z3[Flare report-ready email]
    end

    A --> F
    F --> G
    G --> M
    M --> Z1
    Z1 --> B
    B --> C
    C --> D
    D --> H
    H --> I
    H --> J
    I --> N
    J --> P
    P --> Q
    Q --> R --> S --> T --> U --> V --> W --> X --> Y
    X --> Z2
    Z2 --> E1
    N --> N2[Report in R2, status pending_review]
    K --> L
    L --> O
    O --> Z3
    Z3 --> E2
```

---

## Detailed sequence (all system tasks)

```mermaid
sequenceDiagram
    participant Customer
    participant Stripe
    participant FlareWorker as Flare Worker
    participant FlareQueue as Flare Queue
    participant Resend as Resend
    participant D1 as D1
    participant R2_Flare as R2 (Flare)
    participant MCPWorker as MCP Worker
    participant MCPQueue as MCP Queue
    participant R2_MCP as R2 (MCP)
    participant KV as KV (MCP)

    Note over Customer,KV: 1. PAYMENT
    Customer->>Stripe: Pays (checkout)
    Stripe->>FlareWorker: Webhook: checkout.session.completed
    FlareWorker->>D1: Upsert payment (access_hash, verification_code, customer_email)
    FlareWorker->>FlareQueue: JOBS.send({ type: "send_welcome_email", payment_id })

    Note over FlareQueue,Resend: 2. WELCOME EMAIL
    FlareQueue->>D1: Load payment (customer_email, access_hash)
    FlareQueue->>Resend: Send welcome email (assessment link)
    Resend-->>Customer: Email: "Complete your assessment" + link

    Note over Customer,D1: 3. ASSESSMENT SUBMISSION
    Customer->>FlareWorker: GET /api/assessment-template (load form)
    Customer->>FlareWorker: POST /api/assessments (hash, email, assessment_data)
    FlareWorker->>D1: INSERT contact_submissions (name, email, assessment_data, payment_id)
    FlareWorker->>FlareQueue: JOBS.send({ type: "generate_report", submission_id, payment_id })
    FlareWorker->>MCPWorker: POST /enrich-assessment (buildMCPPayload) [waitUntil]
    FlareWorker-->>Customer: 200 { submission_id, message }

    Note over FlareQueue,R2_Flare: 4a. FLARE REPORT GENERATION
    FlareQueue->>D1: Load submission, ensure report row (pending_review)
    FlareQueue->>D1: Load report template (or default)
    FlareQueue->>FlareQueue: buildReportVars(submission, assessment_data)
    FlareQueue->>FlareQueue: Optional: callClaudeForReport (AI)
    FlareQueue->>FlareQueue: applyReportTemplate(template, vars)
    FlareQueue->>R2_Flare: PUT report HTML
    FlareQueue->>D1: INSERT/UPDATE report_versions (html_path, status draft)

    Note over MCPQueue,KV: 4b. MCP REPORT GENERATION (parallel)
    MCPWorker->>MCPQueue: JOBS.send({ type: "enrich_and_deliver", payload })
    MCPWorker-->>FlareWorker: 202 { submission_id, message }
    MCPQueue->>MCPQueue: domain_scan(domain) → DNS, SSL, SPF/DMARC
    MCPQueue->>MCPQueue: getRelevantVulnerabilities (NVD, optional KV cache)
    MCPQueue->>MCPQueue: getIndustryContext(industry)
    MCPQueue->>MCPQueue: calculateFinancialExposure(...)
    MCPQueue->>MCPQueue: buildControlGapAnalysis(controls)
    MCPQueue->>MCPQueue: buildTemplateVars + fillReportHtml
    MCPQueue->>MCPQueue: Optional: enrichSection (AI)
    MCPQueue->>R2_MCP: PUT report HTML (reports/{submission_id}/...)
    MCPQueue->>Resend: Send report email (link to report)
    MCPQueue->>KV: PUT submission_id → { report_url, generated_at }
    Resend-->>Customer: MCP report email ("Your risk report is ready")

    Note over Customer,Resend: 5. ADMIN APPROVES FLARE REPORT
    FlareWorker->>FlareWorker: Admin: POST /api/admin/reports/:id/approve
    FlareWorker->>D1: UPDATE reports SET status = approved
    FlareWorker->>FlareQueue: JOBS.send({ type: "send_approved_report", report_id })
    FlareQueue->>D1: Load report + submission (recipient email)
    FlareQueue->>Resend: Send "Your report is ready" + /report?hash=...
    Resend-->>Customer: Flare report-ready email (view link)
    Customer->>FlareWorker: GET /report?hash=... (view report)
    FlareWorker->>R2_Flare: GET report HTML
    FlareWorker-->>Customer: HTML report
```

---

## Task list by system

### Stripe
- Process payment (checkout).
- Send webhook `checkout.session.completed` (and optionally `payment_intent.succeeded`) to Flare.

### Flare Worker (HTTP)
- **Webhook:** Verify signature, upsert payment in D1, enqueue `send_welcome_email`.
- **GET /api/assessment-template:** Return assessment form config or custom HTML from D1.
- **POST /api/assessments:** Validate body, resolve payment from hash, rate-limit check, optional Turnstile; INSERT into `contact_submissions`; enqueue `generate_report` (if payment_id); build MCP payload and `POST` to MCP `/enrich-assessment` (fire-and-forget via `waitUntil`); return 200 with `submission_id`.
- **GET /report?hash=...:** Resolve report by view_hash, optionally verify view_code; serve report HTML from R2.
- **Admin:** Approve report → UPDATE report status, enqueue `send_approved_report`.

### Flare Queue Consumer
- **send_welcome_email:** Load payment from D1; build assessment URL; send welcome email via Resend.
- **generate_report:** Load submission and assessment_data from D1; ensure report row; load report template from D1; build report vars (optionally call Claude); apply template; upload HTML to R2; insert/update report_versions.
- **send_approved_report:** Load report and submission from D1; build report view URL; send “report ready” email via Resend; update report status to `sent`.

### MCP Worker (HTTP)
- **POST /enrich-assessment:** Validate payload (submission_id, domain, user_email, etc.); enqueue `enrich_and_deliver`; return 202 with message and submission_id.
- **GET /** (or other paths): Return 404.

### MCP Queue Consumer
- **enrich_and_deliver:** Run orchestrator: `domain_scan(domain)` → `getRelevantVulnerabilities(env, keywords)` → `getIndustryContext(industry)` → `calculateFinancialExposure(...)` → `buildControlGapAnalysis(controls)` → `buildTemplateVars` + `fillReportHtml` → optional `enrichSection` (AI) → `generateAndStoreReport(env, submission_id, html)` (R2 put) → `sendReportEmail(env, { to, subject, htmlBody, reportUrl })` (Resend) → `REPORT_META.put(submission_id, metadata)`. MCP JSON is never stored.

### Resend
- Send welcome email (assessment link).
- Send MCP report email (report link; from MCP service).
- Send Flare “report ready” email (report view link; from Flare queue).

### D1 (Flare)
- Store payments, contact_submissions (with assessment_data), reports, report_versions, email_logs, stripe_webhook_events, etc.
- Report template and assessment template (admin-editable).

### R2 (Flare)
- Store generated Flare report HTML (by report id / version).

### R2 (MCP)
- Store MCP report HTML (by submission_id and timestamp).

### KV (MCP)
- Store only report metadata per submission_id: `{ report_url, pdf_url (optional), report_text (snippet), generated_at }`. MCP JSON is not persisted.

---

## Order of events (customer perspective)

| # | Event |
|---|--------|
| 1 | Customer pays on Stripe. |
| 2 | Customer receives welcome email with assessment link. |
| 3 | Customer opens link, fills assessment, submits. |
| 4 | Customer receives **MCP report email** (automatically, from MCP pipeline). |
| 5 | Admin approves Flare report in Admin → Reports. |
| 6 | Customer receives **Flare report-ready email** with link to view the full Flare report. |
| 7 | Customer opens report link to view the Flare report (HTML from R2). |

So the customer gets **two** report-related emails: one from MCP (risk report, no approval step) and one from Flare (main report, after admin approval).
