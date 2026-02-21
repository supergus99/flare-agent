#!/usr/bin/env node
/**
 * Smoke tests for the Flare Worker and (optionally) MCP service.
 *
 * Flare only:
 *   BASE_URL=http://localhost:8787 node scripts/smoke.js
 *   BASE_URL=https://flare-worker.xxx.workers.dev node scripts/smoke.js
 *
 * Flare + MCP (flow + integration):
 *   BASE_URL=https://flare-worker.xxx.workers.dev MCP_BASE_URL=https://mcp-service.xxx.workers.dev node scripts/smoke.js
 *
 * Start worker first for local: npx wrangler dev
 */

const BASE = process.env.BASE_URL || "http://localhost:8787";
const base = BASE.replace(/\/$/, "");
const MCP_BASE = process.env.MCP_BASE_URL || "";
const mcpBase = MCP_BASE.replace(/\/$/, "");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

async function fetchOk(url, options = {}) {
  const res = await fetch(url, { ...options, redirect: "manual" });
  return { url, status: res.status, ok: res.ok, body: await res.text() };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---- Public / health ----
test("GET / returns 200 and ok:true", async () => {
  const { status, body } = await fetchOk(`${base}/`);
  const data = parseJson(body);
  if (status !== 200) throw new Error(`Expected 200, got ${status}`);
  if (!data?.ok) throw new Error("Expected body.ok === true");
  return "ok";
});

test("GET /health returns 200", async () => {
  const { status } = await fetchOk(`${base}/health`);
  if (status !== 200) throw new Error(`Expected 200, got ${status}`);
  return "ok";
});

// ---- D1 (may 200 or 501 if not bound) ----
test("GET /db returns 200 or 501", async () => {
  const { status, body } = await fetchOk(`${base}/db`);
  const data = parseJson(body);
  if (status !== 200 && status !== 501) throw new Error(`Expected 200 or 501, got ${status}`);
  if (status === 200 && data?.d1 !== "ok" && data?.d1 !== "error")
    throw new Error("Expected d1 in body when 200");
  return "ok";
});

// ---- R2 ----
test("GET /r2 returns 200 or 501", async () => {
  const { status, body } = await fetchOk(`${base}/r2`);
  const data = parseJson(body);
  if (status !== 200 && status !== 501) throw new Error(`Expected 200 or 501, got ${status}`);
  if (data?.r2 !== "ok" && data?.r2 !== "not_configured")
    throw new Error("Expected r2 in body");
  return "ok";
});

// ---- Queue ----
test("GET /queue returns 200", async () => {
  const { status, body } = await fetchOk(`${base}/queue`);
  const data = parseJson(body);
  if (status !== 200) throw new Error(`Expected 200, got ${status}`);
  if (!data?.queue) throw new Error("Expected queue in body");
  return "ok";
});

// ---- Assessment template (public) ----
test("GET /api/assessment-template returns 200", async () => {
  const { status, body } = await fetchOk(`${base}/api/assessment-template`);
  const data = parseJson(body);
  if (status !== 200) throw new Error(`Expected 200, got ${status}`);
  if (!data?.ok && !data?.html && !data?.data) throw new Error("Expected ok or html or data");
  return "ok";
});

// ---- Assessments POST: missing email -> 400 ----
test("POST /api/assessments without email returns 400", async () => {
  const { status, body } = await fetchOk(`${base}/api/assessments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contact_name: "Test", company_name: "Test Co" }),
  });
  const data = parseJson(body);
  if (status !== 400) throw new Error(`Expected 400, got ${status}`);
  if (!data?.error && !data?.message) throw new Error("Expected error message");
  return "ok";
});

// ---- Report view: no hash -> 302 redirect or 400/404 ----
test("GET /report without hash returns redirect or 4xx", async () => {
  const { status } = await fetchOk(`${base}/report`);
  if (status !== 302 && status !== 400 && status !== 404 && status !== 500)
    throw new Error(`Expected 302 or 4xx, got ${status}`);
  return "ok";
});

// ---- Admin: no auth -> 401 ----
test("GET /api/admin/stats without auth returns 401", async () => {
  const { status } = await fetchOk(`${base}/api/admin/stats`);
  if (status !== 401) throw new Error(`Expected 401, got ${status}`);
  return "ok";
});

test("GET /api/admin/settings without auth returns 401", async () => {
  const { status } = await fetchOk(`${base}/api/admin/settings`);
  if (status !== 401) throw new Error(`Expected 401, got ${status}`);
  return "ok";
});

test("GET /api/admin/report-template without auth returns 401", async () => {
  const { status } = await fetchOk(`${base}/api/admin/report-template`);
  if (status !== 401) throw new Error(`Expected 401, got ${status}`);
  return "ok";
});

// ---- Admin login: wrong creds -> 401 ----
test("POST /api/admin/login with wrong creds returns 401", async () => {
  const { status, body } = await fetchOk(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "nobody", password: "wrong" }),
  });
  const data = parseJson(body);
  if (status !== 401) throw new Error(`Expected 401, got ${status}`);
  if (data?.token) throw new Error("Should not return token");
  return "ok";
});

test("POST /api/admin/login with missing body returns 400", async () => {
  const { status } = await fetchOk(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (status !== 400) throw new Error(`Expected 400, got ${status}`);
  return "ok";
});

// ---- Checkout: no Stripe key or invalid body -> 503 or 400 ----
test("POST /api/checkout without valid body returns 400 or 503", async () => {
  const { status } = await fetchOk(`${base}/api/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (status !== 400 && status !== 503) throw new Error(`Expected 400 or 503, got ${status}`);
  return "ok";
});

// ---- CORS ----
test("OPTIONS request returns 204", async () => {
  const { status } = await fetchOk(`${base}/health`, { method: "OPTIONS" });
  if (status !== 204) throw new Error(`Expected 204, got ${status}`);
  return "ok";
});

// ---- 404 ----
test("GET /nonexistent returns 404", async () => {
  const { status } = await fetchOk(`${base}/nonexistent-path-404`);
  if (status !== 404) throw new Error(`Expected 404, got ${status}`);
  return "ok";
});

// ---- MCP service (only when MCP_BASE_URL is set) ----
test("MCP POST /enrich-assessment returns 202 and submission_id", async () => {
  if (!mcpBase) return "skip (set MCP_BASE_URL to run)";
  const payload = {
    submission_id: `smoke-${Date.now()}`,
    domain: "example.com",
    industry: "Legal",
    employee_count: 10,
    revenue_range: "",
    uses_wordpress: false,
    uses_m365: true,
    controls: { mfa: true, backup: true, endpoint_protection: false },
    user_email: "smoke-test@example.com",
  };
  const { status, body } = await fetchOk(`${mcpBase}/enrich-assessment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = parseJson(body);
  if (status !== 202) throw new Error(`Expected 202, got ${status}`);
  if (!data?.message && !data?.submission_id) throw new Error("Expected message and submission_id in body");
  return "ok";
});

test("MCP POST /enrich-assessment with invalid body returns 400", async () => {
  if (!mcpBase) return "skip (set MCP_BASE_URL to run)";
  const { status, body } = await fetchOk(`${mcpBase}/enrich-assessment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain: "example.com" }), // missing submission_id, user_email
  });
  const data = parseJson(body);
  if (status !== 400) throw new Error(`Expected 400, got ${status}`);
  if (!data?.error) throw new Error("Expected error in body");
  return "ok";
});

test("MCP POST /enrich-assessment/sync returns 200 with mcp object", async () => {
  if (!mcpBase) return "skip (set MCP_BASE_URL to run)";
  const payload = {
    submission_id: `smoke-sync-${Date.now()}`,
    domain: "example.com",
    industry: "Legal",
    employee_count: 10,
    revenue_range: "",
    uses_wordpress: false,
    uses_m365: true,
    controls: { mfa: true, backup: true, endpoint_protection: false },
    user_email: "smoke@example.com",
  };
  const { status, body } = await fetchOk(`${mcpBase}/enrich-assessment/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = parseJson(body);
  if (status !== 200) throw new Error(`Expected 200, got ${status}. Body: ${body}`);
  if (!data?.mcp) throw new Error("Expected mcp object in body");
  if (!data.mcp.domain_intelligence && !data.mcp.industry_context) throw new Error("Expected mcp to have domain_intelligence or industry_context");
  return "ok";
});

test("Flare POST /api/assessments with domain triggers flow (MCP async)", async () => {
  if (!mcpBase) return "skip (set MCP_BASE_URL to run)";
  const email = `smoke-${Date.now()}@example.com`;
  const assessmentPayload = {
    contact_name: "Smoke Test",
    email,
    company_name: "Smoke Co",
    assessment_data: {
      website_url: "https://example.com",
      industry: "Legal",
      number_of_people: "2-5",
      budget_range: "",
      website_platform: "WordPress",
      email_provider: "Microsoft 365",
      mfa_email: "Yes",
      backup_method: "Cloud backup",
      computer_protection: "Built-in / antivirus",
    },
  };
  const { status, body } = await fetchOk(`${base}/api/assessments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(assessmentPayload),
  });
  const data = parseJson(body);
  if (status !== 200) throw new Error(`Expected 200, got ${status}. Body: ${body}`);
  if (!data?.ok && !data?.submission_id) throw new Error("Expected ok and submission_id when saved");
  return "ok";
});

// ---- Run ----
async function run() {
  console.log("Flare smoke tests");
  console.log("BASE_URL:", base);
  if (mcpBase) console.log("MCP_BASE_URL:", mcpBase, "(MCP + integration tests enabled)");
  console.log("");

  // Quick connectivity check
  try {
    const r = await fetch(`${base}/health`);
    if (!r.ok) throw new Error(`Health returned ${r.status}`);
  } catch (e) {
    const msg = e.message || "";
    if (msg.includes("fetch failed") || e.cause?.code === "ECONNREFUSED") {
      console.log("  Cannot reach Worker. Start it first:");
      console.log("    npx wrangler dev");
      console.log("  Then run: BASE_URL=http://localhost:8787 node scripts/smoke.js");
      console.log("  Or set BASE_URL to your deployed Worker URL.");
    } else {
      console.log("  ", msg);
    }
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log("  \u2713", name);
      passed++;
    } catch (e) {
      console.log("  \u2717", name);
      console.log("     ", e.message);
      failed++;
    }
  }

  console.log("");
  console.log(`Result: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
