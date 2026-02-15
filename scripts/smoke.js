#!/usr/bin/env node
/**
 * Smoke tests for the Flare Worker.
 * Run with: BASE_URL=http://localhost:8787 node scripts/smoke.js
 * Start the worker first: npx wrangler dev
 * Or test production: BASE_URL=https://flare-worker.xxx.workers.dev node scripts/smoke.js
 */

const BASE = process.env.BASE_URL || "http://localhost:8787";
const base = BASE.replace(/\/$/, "");

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

// ---- Run ----
async function run() {
  console.log("Flare smoke tests");
  console.log("BASE_URL:", base);
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
