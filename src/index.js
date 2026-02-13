import {
  ALLOWED_SERVICES,
  createCheckoutSession,
  verifyWebhook,
  retrieveCheckoutSession,
  retrievePaymentIntent,
} from "./stripe.js";
import { sendResend } from "./email.js";
import { signJwt, verifyJwt, hashAdminPassword } from "./auth.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...headers },
  });
}

function randomHex(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getDefaultAssessmentConfig() {
  return {
    title: "Security assessment",
    intro: "Complete this form so we can generate your report. If you paid via Stripe, use the link from your confirmation email (it includes your secure access code).",
    hashWarning: "No access code in the URL. If you have a link from your payment confirmation, use that. You can still submit without a code; your submission will be saved but not linked to a payment.",
    submitLabel: "Submit assessment",
    fields: [
      { name: "company_name", label: "Company name *", type: "text", required: true, placeholder: "Your company", order: 1 },
      { name: "contact_name", label: "Your name *", type: "text", required: true, placeholder: "Full name", order: 2 },
      { name: "email", label: "Email *", type: "email", required: true, placeholder: "you@example.com", order: 3 },
      { name: "role", label: "Role (optional)", type: "text", required: false, placeholder: "e.g. Operations Manager", order: 4 },
      { name: "message", label: "Additional notes (optional)", type: "textarea", required: false, placeholder: "Any specific concerns or context...", order: 5 },
    ],
  };
}

/** Default assessment page HTML shown in admin when no custom template is saved. */
function getDefaultAssessmentTemplateBody() {
  return (
    "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <title>Assessment – Flare</title>\n  <style>\n    body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 2rem auto; padding: 0 1rem; }\n    h1 { color: #333; }\n    label { display: block; margin-top: 0.75rem; font-weight: 500; }\n    input, textarea { width: 100%; padding: 0.5rem; margin-top: 0.25rem; box-sizing: border-box; }\n    textarea { min-height: 4rem; resize: vertical; }\n    button { margin-top: 1rem; padding: 0.6rem 1.2rem; background: #0969da; color: #fff; border: none; border-radius: 6px; cursor: pointer; }\n    button:disabled { opacity: 0.6; cursor: not-allowed; }\n    .error { color: #cf2222; margin-top: 0.5rem; }\n    .message { margin-top: 1rem; padding: 0.5rem; border-radius: 6px; }\n    .message.success { background: #dafbe1; color: #1a7f37; }\n    .message.error { background: #ffebe9; color: #cf2222; }\n    .hash-warning { background: #fff8c5; padding: 0.5rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.9rem; }\n  </style>\n</head>\n<body>\n  <div id=\"assessment-heading\">\n    <h1>Security assessment</h1>\n    <p>Complete this form so we can generate your report. If you paid via Stripe, use the link from your confirmation email (it includes your secure access code).</p>\n  </div>\n  <div id=\"hash-warning\" class=\"hash-warning\" style=\"display: none;\">\n    No access code in the URL. If you have a link from your payment confirmation, use that. You can still submit without a code; your submission will be saved but not linked to a payment.\n  </div>\n  <form id=\"assessment-form\">\n    <input type=\"hidden\" id=\"access_hash\" name=\"access_hash\" value=\"\">\n    <div id=\"assessment-fields\"></div>\n    <button type=\"submit\" id=\"btn\">Submit assessment</button>\n  </form>\n  <div id=\"message-el\" class=\"message\" style=\"display: none;\"></div>\n  <script>\n    (function () {\n      if (!window.FLARE_WORKER_URL && /^(www\\.)?getflare\\.net$/.test(window.location.hostname)) window.FLARE_WORKER_URL = 'https://api.getflare.net';\n      const WORKER_URL = window.FLARE_WORKER_URL || 'https://flare-worker.gusmao-ricardo.workers.dev';\n      const params = new URLSearchParams(window.location.search);\n      const hash = params.get('hash') || params.get('access_hash') || '';\n      const form = document.getElementById('assessment-form');\n      const btn = document.getElementById('btn');\n      const messageEl = document.getElementById('message-el');\n      const fieldsContainer = document.getElementById('assessment-fields');\n      const headingEl = document.getElementById('assessment-heading');\n      function showMessage(text, isError) {\n        messageEl.textContent = text;\n        messageEl.className = 'message ' + (isError ? 'error' : 'success');\n        messageEl.style.display = 'block';\n      }\n      function renderFormFromConfig(config) {\n        if (!config || !config.fields || !config.fields.length) return;\n        headingEl.innerHTML = '<h1>' + (config.title || 'Security assessment') + '</h1><p>' + (config.intro || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>';\n        document.getElementById('hash-warning').textContent = config.hashWarning || document.getElementById('hash-warning').textContent;\n        btn.textContent = config.submitLabel || 'Submit assessment';\n        const sorted = config.fields.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });\n        fieldsContainer.innerHTML = sorted.map(function (f) {\n          const id = 'field_' + (f.name || '').replace(/\\s/g, '_');\n          const required = f.required ? ' required' : '';\n          if ((f.type || 'text') === 'textarea') {\n            return '<label for=\"' + id + '\">' + (f.label || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</label><textarea id=\"' + id + '\" name=\"' + (f.name || '').replace(/\"/g, '&quot;') + '\"' + required + ' placeholder=\"' + (f.placeholder || '').replace(/\"/g, '&quot;') + '\"></textarea>';\n          }\n          return '<label for=\"' + id + '\">' + (f.label || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</label><input type=\"' + (f.type || 'text') + '\" id=\"' + id + '\" name=\"' + (f.name || '').replace(/\"/g, '&quot;') + '\"' + required + ' placeholder=\"' + (f.placeholder || '').replace(/\"/g, '&quot;') + '\">';\n        }).join('');\n      }\n      function buildPayload() {\n        const payload = { access_hash: document.getElementById('access_hash').value.trim() || undefined };\n        form.querySelectorAll('input[name], textarea[name]').forEach(function (el) {\n          if (el.name && el.name !== 'access_hash') payload[el.name] = el.value.trim();\n        });\n        return payload;\n      }\n      var defaultConfig = { title: 'Security assessment', intro: 'Complete this form so we can generate your report.', hashWarning: 'No access code in the URL.', submitLabel: 'Submit assessment', fields: [\n        { name: 'company_name', label: 'Company name *', type: 'text', required: true, placeholder: 'Your company', order: 1 },\n        { name: 'contact_name', label: 'Your name *', type: 'text', required: true, placeholder: 'Full name', order: 2 },\n        { name: 'email', label: 'Email *', type: 'email', required: true, placeholder: 'you@example.com', order: 3 },\n        { name: 'role', label: 'Role (optional)', type: 'text', required: false, placeholder: 'e.g. Operations Manager', order: 4 },\n        { name: 'message', label: 'Additional notes (optional)', type: 'textarea', required: false, placeholder: 'Any specific concerns...', order: 5 }\n      ] };\n      renderFormFromConfig(defaultConfig);\n      if (window.FLARE_PREVIEW) { document.getElementById('access_hash').value = hash; if (!hash) document.getElementById('hash-warning').style.display = 'block'; return; }\n      fetch(WORKER_URL + '/api/assessment-template').then(function (r) { return r.json(); }).then(function (data) {\n        if (data.ok && data.html) { document.open(); document.write(data.html); document.close(); return; }\n        if (data.ok && data.data && data.data.fields && data.data.fields.length) renderFormFromConfig(data.data);\n      }).catch(function () {});\n      document.getElementById('access_hash').value = hash;\n      if (!hash) document.getElementById('hash-warning').style.display = 'block';\n      form.addEventListener('submit', async function (e) {\n        e.preventDefault();\n        btn.disabled = true;\n        messageEl.style.display = 'none';\n        const payload = buildPayload();\n        if (!payload.email) { showMessage('Email is required', true); btn.disabled = false; return; }\n        try {\n          const res = await fetch(WORKER_URL + '/api/assessments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });\n          const data = await res.json();\n          if (!res.ok) { showMessage(data.error || 'Submission failed', true); btn.disabled = false; return; }\n          showMessage(data.message || 'Assessment saved.', false);\n          form.reset();\n          document.getElementById('access_hash').value = hash;\n        } catch (err) { showMessage(err.message || 'Network error', true); btn.disabled = false; }\n      });\n    })();\n  </script>\n</body>\n</html>"
  );
}

/**
 * Upsert payment from Stripe PaymentIntent (or session-expanded intent).
 * @param {D1Database} db
 * @param {object} intent - Stripe PaymentIntent object (id, amount, currency, metadata, receipt_email)
 * @param {{ email?: string, name?: string }} overrides - From checkout session customer_details
 * @returns {Promise<{ row: object, isNew: boolean } | null>}
 */
async function upsertPaymentFromIntent(db, intent, overrides = {}) {
  if (!intent?.id) return null;
  const transactionId = String(intent.id);
  const amount = intent.amount_received ?? intent.amount ?? 0;
  const currency = (intent.currency ?? "eur").toUpperCase();
  const meta = intent.metadata || {};
  let customerEmail = String(meta.customer_email ?? intent.receipt_email ?? "").trim();
  let customerName = String(meta.customer_name ?? "").trim();
  const customerCompany = String(meta.customer_company ?? "").trim();
  const customerPhone = String(meta.customer_phone ?? "").trim();
  let serviceType = String(meta.service_type ?? "").trim();
  const leadId = meta.lead_id ? parseInt(meta.lead_id, 10) : null;

  if (overrides.email) customerEmail = overrides.email.trim();
  if (overrides.name) customerName = overrides.name.trim();
  if (!customerEmail || !serviceType) return null;
  if (!ALLOWED_SERVICES.includes(serviceType)) serviceType = "core";

  const existing = await db
    .prepare("SELECT * FROM payments WHERE transaction_id = ? LIMIT 1")
    .bind(transactionId)
    .first();
  if (existing) {
    if (existing.payment_status !== "completed") {
      await db
        .prepare("UPDATE payments SET payment_status = 'completed', updated_at = datetime('now') WHERE id = ?")
        .bind(existing.id)
        .run();
    }
    const row = await db.prepare("SELECT * FROM payments WHERE id = ?").bind(existing.id).first();
    return { row: row || existing, isNew: false };
  }

  const accessToken = randomHex(32);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
  const accessHash = await sha256Hex(
    transactionId + customerEmail + serviceType + Date.now() + randomHex(16)
  );

  await db
    .prepare(
      `INSERT INTO payments (
        transaction_id, service_type, amount, currency, customer_email, customer_name,
        customer_company, customer_phone, access_token, access_hash, payment_status,
        payment_provider, lead_id, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', 'stripe', ?, ?)`
    )
    .bind(
      transactionId,
      serviceType,
      amount,
      currency,
      customerEmail,
      customerName || null,
      customerCompany || null,
      customerPhone || null,
      accessToken,
      accessHash,
      leadId,
      expiresAt
    )
    .run();

  const result = await db
    .prepare("SELECT * FROM payments WHERE transaction_id = ? LIMIT 1")
    .bind(transactionId)
    .first();
  if (!result) return null;
  // Regenerate access_hash with payment id for stable link
  const newHash = await sha256Hex(
    result.id + customerEmail + serviceType + Date.now() + randomHex(16)
  );
  await db
    .prepare("UPDATE payments SET access_hash = ? WHERE id = ?")
    .bind(newHash, result.id)
    .run();
  const row = await db.prepare("SELECT * FROM payments WHERE id = ?").bind(result.id).first();
  return { row: row || result, isNew: true };
}

async function sha256Hex(str) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(str));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Flare – Worker entrypoint (fetch + queue consumer)
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ name: "flare", ok: true });
    }
    if (url.pathname === "/db" && env.DB) {
      try {
        const row = await env.DB.prepare("SELECT COUNT(*) as count FROM contact_submissions").first();
        return new Response(
          JSON.stringify({ d1: "ok", submissions_count: row?.count ?? 0 }),
          { headers: { "Content-Type": "application/json" } }
        );
      } catch (e) {
        return new Response(
          JSON.stringify({ d1: "error", message: e.message }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }
    if (url.pathname === "/db") {
      return new Response(
        JSON.stringify({ d1: "not_configured", hint: "Add D1 binding in wrangler.toml" }),
        { status: 501, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.pathname === "/r2") {
      if (!env.REPORTS) {
        return new Response(
          JSON.stringify({ r2: "not_configured", hint: "Add R2 binding and create bucket flare-reports" }),
          { status: 501, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ r2: "ok", bucket: "flare-reports" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.pathname === "/queue" && request.method === "POST" && env.JOBS) {
      try {
        await env.JOBS.send({ type: "test", at: new Date().toISOString() });
        return new Response(
          JSON.stringify({ queue: "ok", message: "Sent test message to flare-jobs" }),
          { headers: { "Content-Type": "application/json" } }
        );
      } catch (e) {
        return new Response(
          JSON.stringify({ queue: "error", message: e.message }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }
    if (url.pathname === "/queue") {
      if (!env.JOBS) {
        return json({ queue: "not_configured", hint: "Create queue flare-jobs and add binding" }, 501);
      }
      return json({ queue: "ok", hint: "POST /queue to send a test message" });
    }

    if (url.pathname === "/submit" && request.method === "POST" && env.DB) {
      try {
        let email = "";
        let name = "";
        const ct = request.headers.get("Content-Type") || "";
        if (ct.includes("application/json")) {
          const body = await request.json();
          email = (body.email || "").trim();
          name = (body.name || "").trim();
        } else if (ct.includes("application/x-www-form-urlencoded")) {
          const body = await request.formData();
          email = (body.get("email") || "").trim();
          name = (body.get("name") || "").trim();
        } else {
          return json({ ok: false, error: "Content-Type must be application/json or application/x-www-form-urlencoded" }, 400);
        }
        if (!email) {
          return json({ ok: false, error: "email is required" }, 400);
        }
        const submitted_at = new Date().toISOString();
        await env.DB.prepare(
          "INSERT INTO contact_submissions (email, name, submitted_at, status) VALUES (?, ?, ?, 'new')"
        ).bind(email, name || null, submitted_at).run();
        return json({ ok: true, message: "Submission saved" });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/submit") {
      if (!env.DB) return json({ ok: false, error: "Database not configured" }, 501);
      return json({ ok: false, error: "POST only" }, 405);
    }

    // ---------- Phase 1: Stripe checkout ----------
    if (url.pathname === "/api/checkout" && request.method === "POST") {
      const stripeKey = env.STRIPE_SECRET_KEY;
      if (!stripeKey) return json({ ok: false, error: "Stripe not configured" }, 503);
      try {
        const body = await request.json().catch(() => ({}));
        const serviceType = String(body.service_type ?? "").trim().toLowerCase();
        if (!ALLOWED_SERVICES.includes(serviceType)) {
          return json({ ok: false, error: "Invalid service_type. Use core, protect, or assure." }, 400);
        }
        const currency = (body.currency ?? "eur").toString().toLowerCase();
        const allowedCurrencies = ["eur", "usd"];
        const cur = allowedCurrencies.includes(currency) ? currency : "eur";
        const workerBase = (env.WORKER_PUBLIC_URL || url.origin).replace(/\/$/, "");
        const pagesBase = (env.SUCCESS_BASE_URL || request.headers.get("Origin") || url.origin).replace(/\/$/, "");
        const successUrl = `${workerBase}/api/success?session_id={CHECKOUT_SESSION_ID}`;
        const cancelUrl = `${pagesBase}/checkout.html?canceled=1`;
        const session = await createCheckoutSession(stripeKey, {
          successUrl,
          cancelUrl,
          serviceType,
          currency: cur,
          customerEmail: body.customer_email?.trim() || undefined,
          customerName: body.customer_name?.trim() || undefined,
          customerCompany: body.customer_company?.trim() || undefined,
        });
        return json({ ok: true, url: session.url, session_id: session.id });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === "/api/webhooks/stripe" && request.method === "POST") {
      const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
      if (!webhookSecret) return new Response("Webhook secret not set", { status: 500 });
      const rawBody = await request.text();
      const sigHeader = request.headers.get("Stripe-Signature") || "";
      try {
        const event = await verifyWebhook(rawBody, sigHeader, webhookSecret);
        const eventId = event.id;
        const eventType = event.type;

        if (env.DB && eventId) {
          const ob = event.data?.object;
          const paymentIntentId = ob?.payment_intent ?? (eventType === "payment_intent.succeeded" || eventType === "payment_intent.payment_failed" ? ob?.id : null);
          const checkoutSessionId = eventType === "checkout.session.completed" ? ob?.id : null;
          try {
            await env.DB.prepare(
              `INSERT INTO stripe_webhook_events (event_id, event_type, livemode, status, payment_intent_id, checkout_session_id)
               VALUES (?, ?, ?, 'received', ?, ?)
               ON CONFLICT(event_id) DO UPDATE SET attempts = attempts + 1, updated_at = datetime('now')`
            )
              .bind(eventId, eventType, event.livemode ? 1 : 0, paymentIntentId ?? null, checkoutSessionId ?? null)
              .run();
          } catch (_) {}
          const existing = await env.DB.prepare("SELECT status FROM stripe_webhook_events WHERE event_id = ?").bind(eventId).first();
          if (existing?.status === "processed") {
            return json({ received: true, idempotent: true });
          }
        }

        if (eventType === "checkout.session.completed") {
          const session = event.data?.object;
          const paymentIntentId = session?.payment_intent;
          if (!paymentIntentId || !env.STRIPE_SECRET_KEY || !env.DB) {
            return json({ received: true });
          }
          const stripeKey = env.STRIPE_SECRET_KEY;
          const intent = await retrievePaymentIntent(stripeKey, typeof paymentIntentId === "string" ? paymentIntentId : paymentIntentId.id);
          const sessionEmail = session?.customer_details?.email?.trim();
          const sessionName = session?.customer_details?.name?.trim();
          const result = await upsertPaymentFromIntent(env.DB, intent, {
            email: sessionEmail || undefined,
            name: sessionName || undefined,
          });
          if (result?.isNew && result.row?.id && env.DB) {
            const leadId = result.row.lead_id ? parseInt(result.row.lead_id, 10) : null;
            if (leadId) {
              try {
                await env.DB.prepare(
                  "UPDATE leads SET converted_at = datetime('now'), payment_id = ?, updated_at = datetime('now') WHERE id = ?"
                )
                  .bind(result.row.id, leadId)
                  .run();
              } catch (_) {}
            }
            if (env.JOBS) {
              try {
                await env.JOBS.send({ type: "send_welcome_email", payment_id: result.row.id });
              } catch (_) {}
            }
          }
        } else if (eventType === "payment_intent.payment_failed") {
          const pi = event.data?.object;
          if (pi?.id && env.DB) {
            try {
              await env.DB.prepare(
                "UPDATE payments SET payment_status = 'failed', updated_at = datetime('now') WHERE transaction_id = ?"
              )
                .bind(pi.id)
                .run();
            } catch (_) {}
          }
        }

        if (env.DB && eventId) {
          try {
            await env.DB.prepare(
              "UPDATE stripe_webhook_events SET status = 'processed', processed_at = datetime('now'), last_error = NULL WHERE event_id = ?"
            )
              .bind(eventId)
              .run();
          } catch (_) {}
        }
        return json({ received: true });
      } catch (e) {
        if (e.message?.includes("signature")) return new Response("Invalid signature", { status: 400 });
        return new Response(e.message || "Webhook error", { status: 500 });
      }
    }

    if (url.pathname === "/api/success" && request.method === "GET" && env.DB && env.STRIPE_SECRET_KEY) {
      const sessionId = url.searchParams.get("session_id");
      if (!sessionId) return json({ ok: false, error: "session_id required" }, 400);
      try {
        const session = await retrieveCheckoutSession(env.STRIPE_SECRET_KEY, sessionId);
        const piId = session.payment_intent?.id ?? session.payment_intent;
        if (!piId) return json({ ok: false, error: "No payment intent" }, 400);
        const transactionId = typeof piId === "string" ? piId : piId.id;
        let payment = await env.DB.prepare("SELECT * FROM payments WHERE transaction_id = ? LIMIT 1").bind(transactionId).first();
        if (!payment) {
          const intent = await retrievePaymentIntent(env.STRIPE_SECRET_KEY, transactionId);
          const sessionEmail = session.customer_details?.email?.trim();
          const sessionName = session.customer_details?.name?.trim();
          const result = await upsertPaymentFromIntent(env.DB, intent, {
            email: sessionEmail || undefined,
            name: sessionName || undefined,
          });
          payment = result?.row ?? null;
        }
        if (!payment) return json({ ok: false, error: "Payment not found" }, 404);
        const base = (env.SUCCESS_BASE_URL || request.headers.get("Origin") || url.origin).replace(/\/$/, "");
        const redirectUrl = `${base}/success.html?hash=${encodeURIComponent(payment.access_hash)}`;
        return Response.redirect(redirectUrl, 302);
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/api/success") {
      return json({ ok: false, error: "Success endpoint requires DB and Stripe" }, 503);
    }

    // ---------- Phase 2: Assessments ----------
    if (url.pathname === "/api/assessments" && request.method === "POST" && env.DB) {
      try {
        const body = await request.json().catch(() => ({}));
        const accessHash = (body.access_hash ?? body.hash ?? "").trim();
        const paymentId = body.payment_id != null ? parseInt(body.payment_id, 10) : null;
        let payment = null;
        if (accessHash) {
          payment = await env.DB.prepare(
            "SELECT id, service_type FROM payments WHERE access_hash = ? AND payment_status = 'completed' LIMIT 1"
          ).bind(accessHash).first();
        }
        if (!payment && paymentId) {
          payment = await env.DB.prepare(
            "SELECT id, service_type FROM payments WHERE id = ? AND payment_status = 'completed' LIMIT 1"
          ).bind(paymentId).first();
        }
        const serviceType = (payment?.service_type ?? "core").toString();
        const name = (body.contact_name ?? body.name ?? "").trim();
        const email = (body.email ?? "").trim();
        const company = (body.company_name ?? body.company ?? "").trim();
        if (!email) return json({ ok: false, error: "email is required" }, 400);
        const message = (body.message ?? body.describe_concerns ?? "").trim().slice(0, 2000);
        const assessmentData = typeof body.assessment_data === "object" ? JSON.stringify(body.assessment_data) : (body.assessment_data ?? "{}");
        const submittedAt = new Date().toISOString().slice(0, 19).replace("T", " ");

        await env.DB.prepare(
          `INSERT INTO contact_submissions (name, email, company, service, payment_id, message, assessment_data, form_version, submitted_at, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`
        )
          .bind(name || null, email, company || null, serviceType, payment?.id ?? null, message || null, assessmentData, "2.0", submittedAt)
          .run();

        const row = await env.DB.prepare("SELECT id FROM contact_submissions WHERE email = ? AND submitted_at = ? ORDER BY id DESC LIMIT 1")
          .bind(email, submittedAt)
          .first();
        const submissionId = row?.id ?? null;

        if (submissionId && env.JOBS && (payment?.id ?? paymentId)) {
          try {
            await env.JOBS.send({
              type: "generate_report",
              submission_id: submissionId,
              payment_id: payment?.id ?? paymentId,
            });
          } catch (_) {}
        }

        return json({
          ok: true,
          message: "Assessment saved. Your report will be generated shortly.",
          submission_id: submissionId,
        });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/api/assessments") {
      return json({ ok: false, error: "POST only or DB not configured" }, 405);
    }

    // ---------- Public: assessment form template (for assessment page) ----------
    if (url.pathname === "/api/assessment-template" && request.method === "GET" && env.DB) {
      try {
        let row = null;
        try {
          row = await env.DB.prepare("SELECT form_config, body FROM assessment_template WHERE id = 1 LIMIT 1").first();
        } catch (_) {
          row = await env.DB.prepare("SELECT form_config FROM assessment_template WHERE id = 1 LIMIT 1").first();
        }
        const body = row?.body ?? null;
        if (body != null && String(body).trim() !== "") {
          return json({ ok: true, html: body });
        }
        const formConfig = row?.form_config ? JSON.parse(row.form_config) : getDefaultAssessmentConfig();
        return json({ ok: true, data: formConfig });
      } catch (e) {
        return json({ ok: true, data: getDefaultAssessmentConfig() });
      }
    }

    // ---------- Phase 2: Report view by hash ----------
    if (url.pathname === "/report" && request.method === "GET" && env.DB) {
      const hash = url.searchParams.get("hash") ?? url.searchParams.get("h") ?? "";
      if (!hash) return json({ error: "hash required" }, 400);
      try {
        let report = await env.DB.prepare(
          "SELECT id, payment_id, view_hash, view_expires_at, status FROM reports WHERE view_hash = ? LIMIT 1"
        ).bind(hash).first();
        if (!report) {
          const payment = await env.DB.prepare(
            "SELECT id FROM payments WHERE access_hash = ? LIMIT 1"
          ).bind(hash).first();
          if (payment) {
            report = await env.DB.prepare(
              "SELECT id, payment_id, view_hash, view_expires_at, status FROM reports WHERE payment_id = ? ORDER BY id DESC LIMIT 1"
            ).bind(payment.id).first();
          }
        }
        if (!report) {
          return new Response(
            "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>Report not found</title></head><body><h1>Report not found</h1><p>The link may be invalid or expired.</p></body></html>",
            { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        }
        const viewExpires = report.view_expires_at;
        if (viewExpires && viewExpires < new Date().toISOString().slice(0, 19)) {
          return new Response(
            "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>Link expired</title></head><body><h1>Link expired</h1><p>This report link has expired.</p></body></html>",
            { status: 410, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        }
        const allowedStatus = ["pending_review", "approved", "sent"];
        if (!allowedStatus.includes(report.status)) {
          return new Response(
            "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>Report not available</title></head><body><h1>Report not available</h1><p>The report is not ready yet.</p></body></html>",
            { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        }
        const version = await env.DB.prepare(
          "SELECT html_path FROM report_versions WHERE report_id = ? AND html_path IS NOT NULL AND html_path != '' ORDER BY version DESC LIMIT 1"
        ).bind(report.id).first();
        if (!version?.html_path || !env.REPORTS) {
          return new Response(
            "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>Report generating</title></head><body><h1>Report not ready</h1><p>Your report is still being generated. Try again in a few minutes.</p></body></html>",
            { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        }
        const obj = await env.REPORTS.get(version.html_path);
        if (!obj) {
          return new Response(
            "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>Report error</title></head><body><h1>Report unavailable</h1><p>The report file could not be loaded.</p></body></html>",
            { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        }
        const html = await obj.text();
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, max-age=300" },
        });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // ---------- Phase 3: Admin ----------
    function getAdminToken(req) {
      const auth = req.headers.get("Authorization") || "";
      const match = auth.match(/Bearer\s+(.+)/i);
      if (match) return match[1].trim();
      const cookie = req.headers.get("Cookie") || "";
      const m = cookie.match(/admin_token=([^;]+)/);
      return m ? m[1].trim() : null;
    }

    if (url.pathname === "/api/admin/login" && request.method === "POST" && env.DB) {
      try {
        const body = await request.json().catch(() => ({}));
        const username = (body.username ?? "").trim();
        const password = (body.password ?? "");
        if (!username || !password) return json({ ok: false, error: "username and password required" }, 400);
        const secret = env.ADMIN_JWT_SECRET;
        const salt = env.ADMIN_PASSWORD_SALT;
        if (!secret || !salt) return json({ ok: false, error: "Admin auth not configured" }, 503);
        const admin = await env.DB.prepare(
          "SELECT id, username, password_hash FROM admin_users WHERE username = ? AND is_active = 1 LIMIT 1"
        ).bind(username).first();
        if (!admin) return json({ ok: false, error: "Invalid credentials" }, 401);
        const saltTrimmed = (salt || "").trim();
        const hash = await hashAdminPassword(saltTrimmed, password);
        const storedHash = (admin.password_hash || "").trim().toLowerCase();
        if (hash.toLowerCase() !== storedHash) return json({ ok: false, error: "Invalid credentials" }, 401);
        const exp = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
        const token = await signJwt(secret, { sub: String(admin.id), exp });
        return json({ ok: true, token });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    async function requireAdmin(req, env) {
      const token = getAdminToken(req);
      if (!token || !env.ADMIN_JWT_SECRET) return null;
      const payload = await verifyJwt(env.ADMIN_JWT_SECRET, token);
      return payload?.sub ? payload : null;
    }

    if (url.pathname === "/api/admin/submissions" && request.method === "GET" && env.DB) {
      const admin = await requireAdmin(request, env);
      if (!admin) return json({ error: "Unauthorized" }, 401);
      try {
        const limit = Math.min(100, parseInt(url.searchParams.get("limit") || "50", 10));
        const rows = await env.DB.prepare(
          "SELECT id, name, email, company, service, payment_id, submitted_at, status FROM contact_submissions ORDER BY id DESC LIMIT ?"
        ).bind(limit).all();
        return json({ ok: true, data: rows.results });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    if (url.pathname === "/api/admin/payments" && request.method === "GET" && env.DB) {
      const admin = await requireAdmin(request, env);
      if (!admin) return json({ error: "Unauthorized" }, 401);
      try {
        const limit = Math.min(100, parseInt(url.searchParams.get("limit") || "50", 10));
        const rows = await env.DB.prepare(
          "SELECT id, transaction_id, service_type, amount, currency, customer_email, customer_name, payment_status, created_at FROM payments ORDER BY id DESC LIMIT ?"
        ).bind(limit).all();
        return json({ ok: true, data: rows.results });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    if (url.pathname === "/api/admin/reports" && request.method === "GET" && env.DB) {
      const admin = await requireAdmin(request, env);
      if (!admin) return json({ error: "Unauthorized" }, 401);
      try {
        const limit = Math.min(100, parseInt(url.searchParams.get("limit") || "50", 10));
        const rows = await env.DB.prepare(
          "SELECT r.id, r.payment_id, r.submission_id, r.report_type, r.status, r.view_hash, r.created_at FROM reports r ORDER BY r.id DESC LIMIT ?"
        ).bind(limit).all();
        return json({ ok: true, data: rows.results });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    if (url.pathname === "/api/admin/stats" && request.method === "GET" && env.DB) {
      const admin = await requireAdmin(request, env);
      if (!admin) return json({ error: "Unauthorized" }, 401);
      try {
        const [submissions, payments, reports, pending] = await Promise.all([
          env.DB.prepare("SELECT COUNT(*) as n FROM contact_submissions").first(),
          env.DB.prepare("SELECT COUNT(*) as n FROM payments").first(),
          env.DB.prepare("SELECT COUNT(*) as n FROM reports").first(),
          env.DB.prepare("SELECT COUNT(*) as n FROM reports WHERE status = 'pending_review'").first(),
        ]);
        return json({
          ok: true,
          submissions: submissions?.n ?? 0,
          payments: payments?.n ?? 0,
          reports: reports?.n ?? 0,
          reports_pending_review: pending?.n ?? 0,
        });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    if (url.pathname === "/api/admin/assessment-template" && env.DB) {
      const admin = await requireAdmin(request, env);
      if (!admin) return json({ error: "Unauthorized" }, 401);
      if (request.method === "GET") {
        try {
          let row = await env.DB.prepare("SELECT form_config, body, updated_at FROM assessment_template WHERE id = 1 LIMIT 1").first();
          if (!row) row = await env.DB.prepare("SELECT form_config, updated_at FROM assessment_template WHERE id = 1 LIMIT 1").first();
          const formConfig = row?.form_config ? JSON.parse(row.form_config) : getDefaultAssessmentConfig();
          const body = row?.body ?? null;
          const defaultBody = (body == null || body === "") ? getDefaultAssessmentTemplateBody() : null;
          return json({ ok: true, data: formConfig, body: body, defaultBody, updated_at: row?.updated_at ?? null });
        } catch (e) {
          try {
            const row = await env.DB.prepare("SELECT form_config, updated_at FROM assessment_template WHERE id = 1 LIMIT 1").first();
            const formConfig = row?.form_config ? JSON.parse(row.form_config) : getDefaultAssessmentConfig();
            return json({ ok: true, data: formConfig, body: null, defaultBody: getDefaultAssessmentTemplateBody(), updated_at: row?.updated_at ?? null });
          } catch (e2) {
            return json({ ok: true, data: getDefaultAssessmentConfig(), body: null, defaultBody: getDefaultAssessmentTemplateBody() });
          }
        }
      }
      if (request.method === "PUT") {
        try {
          const reqBody = await request.json();
          const templateBody = typeof reqBody.body === "string" ? reqBody.body : null;
          const formConfig = typeof reqBody.form_config === "object" ? reqBody.form_config : (reqBody.data ? reqBody.data : getDefaultAssessmentConfig());
          const configStr = JSON.stringify(formConfig);
          try {
            if (templateBody !== null) {
              await env.DB.prepare("INSERT INTO assessment_template (id, form_config, body, updated_at) VALUES (1, ?, ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET form_config = excluded.form_config, body = excluded.body, updated_at = datetime('now')").bind(configStr, templateBody).run();
            } else {
              await env.DB.prepare("INSERT INTO assessment_template (id, form_config, updated_at) VALUES (1, ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET form_config = excluded.form_config, updated_at = datetime('now')").bind(configStr).run();
            }
          } catch (colErr) {
            await env.DB.prepare("INSERT INTO assessment_template (id, form_config, updated_at) VALUES (1, ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET form_config = excluded.form_config, updated_at = datetime('now')").bind(configStr).run();
          }
          return json({ ok: true, message: "Assessment template saved" });
        } catch (e) {
          return json({ error: e.message }, 500);
        }
      }
      return json({ error: "Method not allowed" }, 405);
    }

    if (url.pathname === "/api/admin/assessment-template-full" && request.method === "GET") {
      const admin = await requireAdmin(request, env);
      if (!admin) return json({ error: "Unauthorized" }, 401);
      const templateUrl = env.ASSESSMENT_FULL_TEMPLATE_URL;
      if (templateUrl && typeof templateUrl === "string") {
        try {
          const res = await fetch(templateUrl);
          if (res.ok) {
            const text = await res.text();
            return new Response(text, { headers: { "Content-Type": "text/html; charset=utf-8" } });
          }
        } catch (_) {}
      }
      return new Response("", { status: 404 });
    }

    if (url.pathname === "/api/admin/report-template" && env.DB) {
      const admin = await requireAdmin(request, env);
      if (!admin) return json({ error: "Unauthorized" }, 401);
      if (request.method === "GET") {
        try {
          const row = await env.DB.prepare("SELECT body, updated_at FROM report_templates WHERE id = 1 LIMIT 1").first();
          const body = row?.body ?? null;
          const defaultBody = body == null || body === "" ? getDefaultReportTemplateBody() : null;
          return json({ ok: true, data: body, defaultBody, updated_at: row?.updated_at ?? null });
        } catch (e) {
          return json({ ok: true, data: null, defaultBody: getDefaultReportTemplateBody() });
        }
      }
      if (request.method === "PUT") {
        try {
          const body = await request.json();
          const templateBody = typeof body.body === "string" ? body.body : (body.data != null ? String(body.data) : null);
          await env.DB.prepare("INSERT INTO report_templates (id, name, body, updated_at) VALUES (1, 'default', ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = datetime('now')").bind(templateBody || null).run();
          return json({ ok: true, message: "Report template saved" });
        } catch (e) {
          return json({ error: e.message }, 500);
        }
      }
      return json({ error: "Method not allowed" }, 405);
    }

    const reportApproveMatch = url.pathname.match(/^\/api\/admin\/reports\/(\d+)\/approve$/);
    if (reportApproveMatch && request.method === "POST" && env.DB) {
      const admin = await requireAdmin(request, env);
      if (!admin) return json({ error: "Unauthorized" }, 401);
      const reportId = parseInt(reportApproveMatch[1], 10);
      if (!reportId) return json({ error: "Invalid report id" }, 400);
      try {
        const report = await env.DB.prepare("SELECT id, status FROM reports WHERE id = ?").bind(reportId).first();
        if (!report) return json({ error: "Report not found" }, 404);
        if (report.status === "sent") return json({ ok: true, message: "Already sent" });
        await env.DB.prepare("UPDATE reports SET status = 'approved', updated_at = datetime('now') WHERE id = ?").bind(reportId).run();
        if (env.JOBS) {
          try {
            await env.JOBS.send({ type: "send_approved_report", report_id: reportId });
          } catch (_) {}
        }
        return json({ ok: true, message: "Report approved; email queued" });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    return new Response("Not Found", { status: 404 });
  },

  async queue(batch, env, ctx) {
    for (const msg of batch.messages) {
      try {
        const body = msg.body;
        if (body?.type === "test") {
          console.log("Queue test message:", body);
          msg.ack();
          continue;
        }
        if (body?.type === "generate_report" && env.DB && env.REPORTS) {
          await handleGenerateReport(env, body);
          msg.ack();
          continue;
        }
        if (body?.type === "send_welcome_email" && env.DB) {
          await handleSendWelcomeEmail(env, body);
          msg.ack();
          continue;
        }
        if (body?.type === "send_approved_report" && env.DB) {
          await handleSendApprovedReport(env, body);
          msg.ack();
          continue;
        }
        msg.ack();
      } catch (e) {
        msg.retry();
      }
    }
  },
};

async function handleGenerateReport(env, body) {
  const submissionId = body.submission_id ? parseInt(body.submission_id, 10) : 0;
  const paymentId = body.payment_id ? parseInt(body.payment_id, 10) : 0;
  if (!submissionId || !paymentId) return;

  const submission = await env.DB.prepare(
    "SELECT id, name, email, company, service, message, assessment_data FROM contact_submissions WHERE id = ?"
  ).bind(submissionId).first();
  if (!submission) return;

  let report = await env.DB.prepare(
    "SELECT id FROM reports WHERE payment_id = ? AND submission_id = ? LIMIT 1"
  ).bind(paymentId, submissionId).first();

  if (!report) {
    const viewHash = randomHex(32);
    const viewExpires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
    await env.DB.prepare(
      "INSERT INTO reports (payment_id, submission_id, report_type, status, view_hash, view_expires_at) VALUES (?, ?, 'initial', 'pending_review', ?, ?)"
    ).bind(paymentId, submissionId, viewHash, viewExpires).run();
    report = await env.DB.prepare(
      "SELECT id FROM reports WHERE payment_id = ? AND submission_id = ? LIMIT 1"
    ).bind(paymentId, submissionId).first();
  }
  if (!report) return;

  const versionRow = await env.DB.prepare(
    "SELECT id, version FROM report_versions WHERE report_id = ? ORDER BY version DESC LIMIT 1"
  ).bind(report.id).first();
  const nextVersion = versionRow ? (parseInt(versionRow.version, 10) + 1) : 1;

  await env.DB.prepare(
    "INSERT INTO report_versions (report_id, version, status) VALUES (?, ?, 'generating')"
  ).bind(report.id, nextVersion).run();
  const versionInsert = await env.DB.prepare(
    "SELECT id FROM report_versions WHERE report_id = ? AND version = ? LIMIT 1"
  ).bind(report.id, nextVersion).first();
  const versionId = versionInsert?.id;

  const data = typeof submission.assessment_data === "string" ? JSON.parse(submission.assessment_data || "{}") : (submission.assessment_data || {});
  const reportVars = buildReportVars(submission, data);
  let htmlContent = "";
  try {
    const templateRow = await env.DB.prepare("SELECT body FROM report_templates WHERE id = 1 AND body IS NOT NULL AND body != '' LIMIT 1").first();
    const templateBody = templateRow?.body ? templateRow.body : getDefaultReportTemplateBody();
    htmlContent = applyReportTemplate(templateBody, reportVars);
  } catch (_) {
    htmlContent = applyReportTemplate(getDefaultReportTemplateBody(), reportVars);
  }

  const r2Key = `reports/${report.id}/v${nextVersion}.html`;
  await env.REPORTS.put(r2Key, htmlContent, {
    httpMetadata: { contentType: "text/html; charset=utf-8" },
  });

  const completedAt = new Date().toISOString().slice(0, 19).replace("T", " ");
  await env.DB.prepare(
    "UPDATE report_versions SET status = 'draft', html_path = ?, completed_at = ? WHERE id = ?"
  ).bind(r2Key, completedAt, versionId).run();
}

async function getFromEmail(env) {
  if (env.FROM_EMAIL) return env.FROM_EMAIL;
  try {
    const row = await env.DB.prepare("SELECT setting_value FROM automation_settings WHERE setting_key = 'from_email' LIMIT 1").first();
    return row?.setting_value || "Flare <noreply@example.com>";
  } catch (_) {
    return "Flare <noreply@example.com>";
  }
}

async function getFromName(env) {
  if (env.FROM_NAME) return env.FROM_NAME;
  try {
    const row = await env.DB.prepare("SELECT setting_value FROM automation_settings WHERE setting_key = 'from_name' LIMIT 1").first();
    return row?.setting_value || "Flare";
  } catch (_) {
    return "Flare";
  }
}

async function handleSendWelcomeEmail(env, body) {
  const paymentId = body.payment_id ? parseInt(body.payment_id, 10) : 0;
  if (!paymentId || !env.RESEND_API_KEY) return;
  const payment = await env.DB.prepare(
    "SELECT id, customer_email, customer_name, access_hash, service_type, payment_status FROM payments WHERE id = ?"
  ).bind(paymentId).first();
  if (!payment || payment.payment_status !== "completed") return;
  const to = payment.customer_email?.trim();
  if (!to) return;
  const base = env.SUCCESS_BASE_URL || env.WORKER_PUBLIC_URL || "https://flare-agent.pages.dev";
  const assessmentUrl = `${base.replace(/\/$/, "")}/assessment.html?hash=${encodeURIComponent(payment.access_hash || "")}`;
  const name = payment.customer_name || "there";
  const fromName = await getFromName(env);
  const fromEmail = await getFromEmail(env);
  const from = fromEmail.includes("<") ? fromEmail : `${fromName} <${fromEmail}>`;
  const subject = "Welcome – complete your security assessment";
  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;max-width:36em;margin:1rem auto;"><p>Hi ${escapeHtml(name)},</p><p>Thanks for your purchase. Complete your assessment to receive your report:</p><p><a href="${escapeHtml(assessmentUrl)}">${escapeHtml(assessmentUrl)}</a></p><p>— ${escapeHtml(fromName)}</p></body></html>`;
  const result = await sendResend(env.RESEND_API_KEY, { from, to, subject, html });
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  try {
    await env.DB.prepare(
      "INSERT INTO email_logs (payment_id, email_type, recipient_email, subject, status, sent_at, error_message) VALUES (?, 'welcome', ?, ?, ?, ?, ?)"
    ).bind(paymentId, to, subject, result.error ? "failed" : "sent", result.error ? null : now, result.error || null).run();
  } catch (_) {}
}

async function handleSendApprovedReport(env, body) {
  const reportId = body.report_id ? parseInt(body.report_id, 10) : 0;
  if (!reportId || !env.RESEND_API_KEY) return;
  const report = await env.DB.prepare(
    "SELECT r.id, r.payment_id, r.submission_id, r.view_hash, r.status FROM reports r WHERE r.id = ?"
  ).bind(reportId).first();
  if (!report || !report.view_hash) return;
  let to = null;
  let name = "there";
  if (report.payment_id) {
    const p = await env.DB.prepare("SELECT customer_email, customer_name FROM payments WHERE id = ?").bind(report.payment_id).first();
    if (p) {
      to = p.customer_email?.trim();
      name = p.customer_name || name;
    }
  }
  if (!to && report.submission_id) {
    const sub = await env.DB.prepare("SELECT email, name FROM contact_submissions WHERE id = ?").bind(report.submission_id).first();
    if (sub) {
      to = sub.email?.trim();
      name = sub.name || name;
    }
  }
  if (!to) return;
  const workerBase = (env.WORKER_PUBLIC_URL || "https://flare-worker.gusmao-ricardo.workers.dev").replace(/\/$/, "");
  const reportUrl = `${workerBase}/report?hash=${encodeURIComponent(report.view_hash)}`;
  const fromName = await getFromName(env);
  const fromEmail = await getFromEmail(env);
  const from = fromEmail.includes("<") ? fromEmail : `${fromName} <${fromEmail}>`;
  const subject = "Your security assessment report is ready";
  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;max-width:36em;margin:1rem auto;"><p>Hi ${escapeHtml(name)},</p><p>Your report is ready. View it here:</p><p><a href="${escapeHtml(reportUrl)}">${escapeHtml(reportUrl)}</a></p><p>— ${escapeHtml(fromName)}</p></body></html>`;
  const result = await sendResend(env.RESEND_API_KEY, { from, to, subject, html });
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  try {
    await env.DB.prepare(
      "INSERT INTO email_logs (payment_id, report_id, email_type, recipient_email, subject, status, sent_at, error_message) VALUES (?, ?, 'report_ready', ?, ?, ?, ?, ?)"
    ).bind(report.payment_id, reportId, to, subject, result.error ? "failed" : "sent", result.error ? null : now, result.error || null).run();
    if (!result.error) {
      await env.DB.prepare("UPDATE reports SET status = 'sent', updated_at = datetime('now') WHERE id = ?").bind(reportId).run();
    }
  } catch (_) {}
}

function applyReportTemplate(templateBody, vars) {
  let out = templateBody;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), escapeHtml(String(value ?? "")));
  }
  return out;
}

function buildReportVars(submission, data) {
  const d = data || {};
  const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const join = (v) => arr(v).join(", ") || "—";
  const str = (v) => (v != null && String(v).trim() !== "" ? String(v).trim() : "—");
  const unitsTotal = d.units_total != null ? String(d.units_total) : "";
  const unitsRange = unitsTotal || "—";
  const countries = join(d.regions_operated);
  return {
    name: str(submission.name) !== "—" ? str(submission.name) : str(submission.email) || "Customer",
    company: str(submission.company),
    email: str(submission.email),
    role: str(d.role),
    service: str(submission.service),
    message: str(submission.message) !== "—" ? str(submission.message) : str(d.describe_concerns),
    report_date: new Date().toISOString().slice(0, 10),
    website_url: str(d.website_url || d.website),
    website_href: (d.website_url || d.website) && String(d.website_url || d.website).trim() ? String(d.website_url || d.website).trim() : "#",
    units_range: unitsRange,
    countries: countries,
    language: str(d.language) || "—",
  };
}

/** Full report template (STR structure) with Flare styling. Placeholders: {{name}}, {{company}}, {{email}}, {{role}}, {{service}}, {{message}}, {{report_date}}, {{website_url}}, {{units_range}}, {{countries}}, {{language}} */
function getDefaultReportTemplateBody() {
  return getDefaultReportTemplateBodyFlare();
}
function getDefaultReportTemplateBodyFlare() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Security & Operations Risk Assessment Report – Flare</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root { --bg: #0a0a0b; --bg-card: #111113; --text: #e4e4e7; --muted: #71717a; --accent: #22d3ee; --border: rgba(255,255,255,0.06); --pill-low: #10b981; --pill-mod: #f59e0b; --pill-high: #f97316; --pill-crit: #ef4444; }
    html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: 'Outfit', system-ui, sans-serif; line-height: 1.55; }
    .report { max-width: 960px; margin: 32px auto 64px; padding: 0 16px; }
    .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 16px; }
    .report-header { background: linear-gradient(135deg, #0e7490 0%, #0891b2 50%, #22d3ee 100%); color: #fff; padding: 28px 24px; border-radius: 14px; margin-bottom: 18px; }
    .report-header h1 { margin: 0 0 8px; font-size: 26px; font-weight: 700; }
    .report-header .subtitle { margin: 0; color: rgba(255,255,255,0.9); font-size: 14px; }
    h2 { font-size: 20px; margin: 0 0 12px; color: var(--text); }
    h3 { font-size: 16px; margin: 18px 0 8px; color: var(--accent); }
    p { margin: 8px 0; }
    ul { margin: 8px 0 8px 20px; }
    .meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 20px; }
    .kv { display: grid; grid-template-columns: 160px 1fr; gap: 12px; }
    .kv label { color: var(--muted); font-weight: 600; font-size: 0.9rem; }
    .pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 6px 12px; font-size: 13px; font-weight: 600; color: #fff; background: var(--muted); }
    .pill.low, .pill.Low { background: var(--pill-low); }
    .pill.moderate, .pill.Moderate { background: var(--pill-mod); }
    .pill.high, .pill.High { background: var(--pill-high); }
    .pill.critical, .pill.Critical { background: var(--pill-crit); }
    .grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .kpi { display: flex; align-items: center; justify-content: space-between; border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; background: var(--bg); }
    .kpi small, .muted { color: var(--muted); }
    .section-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
    a { color: var(--accent); }
    @media (max-width: 720px) { .meta-grid, .grid-2, .kv { grid-template-columns: 1fr; } }
    @media print { body { background: #fff; color: #111; } .card, .report-header { box-shadow: none; } .pill { print-color-adjust: exact; } }
  </style>
</head>
<body>
  <div class="report">
    <header class="report-header">
      <h1>Security & Operations Risk Assessment Report</h1>
      <p class="subtitle">Generated from assessment data · Flare · getflare.net</p>
    </header>
    <section class="card">
      <div class="section-title"><h2>1) Report Metadata</h2></div>
      <div class="meta-grid">
        <div class="kv"><label>Company</label><div>{{company}}</div></div>
        <div class="kv"><label>Website</label><div><a href="{{website_href}}" target="_blank" rel="noopener">{{website_url}}</a></div></div>
        <div class="kv"><label>Prepared for</label><div>{{name}} — {{role}}</div></div>
        <div class="kv"><label>Prepared by</label><div>Flare</div></div>
        <div class="kv"><label>Assessment Date</label><div>{{report_date}}</div></div>
        <div class="kv"><label>Scope</label><div>{{units_range}} units across {{countries}}</div></div>
        <div class="kv"><label>Language/Locale</label><div>{{language}}</div></div>
      </div>
    </section>
    <section class="card">
      <div class="section-title"><h2>2) Executive Summary</h2><span class="pill">Overall Risk: [Low | Moderate | High | Critical]</span></div>
      <h3>Top 5 Findings</h3>
      <ul>
        <li>[Finding #1 — short impact statement]</li>
        <li>[Finding #2]</li>
        <li>[Finding #3]</li>
        <li>[Finding #4]</li>
        <li>[Finding #5]</li>
      </ul>
      <h3>Priority Recommendations (0–90 days)</h3>
      <ul>
        <li>[Action 1 — 0–30 days] &rarr; Impact: [High/Med/Low]</li>
        <li>[Action 2 — 0–60 days] &rarr; Impact: [High/Med/Low]</li>
        <li>[Action 3 — 0–90 days] &rarr; Impact: [High/Med/Low]</li>
      </ul>
      <div class="grid-2">
        <div class="kpi"><div><strong>Estimated Budget Range</strong><br><small class="muted">[Notes on scope]</small></div><div>[Currency + range]</div></div>
        <div class="kpi"><div><strong>Target Timeline</strong><br><small class="muted">[e.g. Core items within 90 days]</small></div><div>[Start date / cadence]</div></div>
      </div>
    </section>
    <section class="card">
      <h2>3) Environment Profile (From Assessment)</h2>
      <p class="muted">Aligned to the assessment sections.</p>
      <h3>3.1 Company Information</h3>
      <ul>
        <li>Company Name: {{company}}</li>
        <li>Contact: {{name}} — {{email}}</li>
        <li>Role: {{role}}</li>
      </ul>
      <h3>3.2 Access Control</h3>
      <ul><li>Authentication Method(s): [Password / SSO / MFA / Biometric]</li><li>MFA Enabled: [Yes / No]</li><li>Password Policy: [Basic / Standard / Strong / None]</li><li>Access Review Frequency: [Quarterly / Semi-annual / Annual / Ad-hoc / Never]</li></ul>
      <h3>3.3 Network Security</h3>
      <ul><li>Firewall Solution: [Enterprise / SMB / Cloud-native / None]</li><li>VPN Usage: [Always / Sometimes / Never]</li><li>Network Segmentation: [Yes / Partial / No]</li><li>Intrusion Detection: [IDS/IPS / EDR / None]</li></ul>
      <h3>3.4 Data Protection</h3>
      <ul><li>Encryption at Rest: [Yes / Partial / No]</li><li>Encryption in Transit: [Yes / Partial / No]</li><li>Backup Frequency: [Daily / Weekly / Monthly / Never]</li><li>Backup Testing: [Regular / Occasional / Never]</li><li>Data Classification: [Yes / Partial / No]</li></ul>
      <h3>3.5 Endpoint Security</h3>
      <ul><li>Antivirus / EPP: [Enterprise / Consumer / None]</li><li>Endpoint Detection (EDR/XDR): [Yes / No]</li><li>Patch Management: [Automated / Manual / Ad-hoc / None]</li><li>Mobile Device Management: [Yes / Partial / No]</li></ul>
      <h3>3.6 Security Monitoring</h3>
      <ul><li>SIEM / Log Management: [SIEM / Cloud-native / Basic logs / None]</li><li>Log Retention: [90+ days / 30–90 / &lt;30 / None]</li><li>Incident Response Plan: [Yes, documented / Informal / No]</li><li>Vulnerability Scanning: [Regular / Occasional / Never]</li></ul>
      <h3>3.7 Compliance &amp; Policies</h3>
      <ul><li>Compliance Frameworks: [SOC 2 / ISO 27001 / HIPAA / PCI DSS / GDPR / None]</li><li>Security Policies: [Documented / Partial / None]</li><li>Security Training: [Regular / Annual / None]</li><li>Third-Party Risk Management: [Yes / Partial / No]</li></ul>
      <h3>3.8 Additional Information</h3>
      <ul><li>Recent Security Incidents: [Client free-text or "None reported"]</li><li>Security Concerns: {{message}}</li><li>Additional Comments: [Client free-text]</li></ul>
    </section>
    <section class="card">
      <h2>4) Risk Scoring Framework</h2>
      <p class="muted">Scale (0–5): 0=Not implemented, 1=Ad-hoc, 2=Basic, 3=Defined, 4=Managed, 5=Optimized. Risk: 0–1.4 Low &middot; 1.5–2.9 Moderate &middot; 3.0–3.9 High &middot; 4.0–5.0 Critical</p>
      <div class="grid-2">
        <div class="kpi"><div>Access Control: [x/5]</div><div><span class="pill">[Level]</span></div></div>
        <div class="kpi"><div>Network Security: [x/5]</div><div><span class="pill">[Level]</span></div></div>
        <div class="kpi"><div>Data Protection: [x/5]</div><div><span class="pill">[Level]</span></div></div>
        <div class="kpi"><div>Endpoint Security: [x/5]</div><div><span class="pill">[Level]</span></div></div>
        <div class="kpi"><div>Security Monitoring: [x/5]</div><div><span class="pill">[Level]</span></div></div>
        <div class="kpi"><div>Compliance &amp; Policies: [x/5]</div><div><span class="pill">[Level]</span></div></div>
      </div>
      <div class="kpi" style="margin-top:12px;"><div><strong>Overall Risk Score (weighted): [x.xx/5]</strong></div><div><span class="pill">[Overall Level]</span></div></div>
    </section>
    <section class="card">
      <h2>5) Key Findings &amp; Gaps (Evidence-Based)</h2>
      <h3>5.1 Access Control</h3>
      <ul><li><strong>Strengths:</strong> [List strengths]</li><li><strong>Gaps:</strong> [List gaps]</li><li><strong>Impact:</strong> [Operational / Security / Compliance]</li><li><strong>Evidence:</strong> [Quote assessment Section 3.2]</li><li><strong>Risk Rating:</strong> <span class="pill">[Level]</span></li><li><strong>Remediation:</strong> <ul><li>[Action 1]</li><li>[Action 2]</li></ul></li></ul>
      <h3>5.2 Network Security</h3>
      <ul><li><strong>Strengths:</strong> [List strengths]</li><li><strong>Gaps:</strong> [List gaps]</li><li><strong>Impact:</strong> [Impact type]</li><li><strong>Evidence:</strong> [Quote Section 3.3]</li><li><strong>Risk Rating:</strong> <span class="pill">[Level]</span></li><li><strong>Remediation:</strong> <ul><li>[Content]</li></ul></li></ul>
      <h3>5.3 Data Protection</h3>
      <ul><li><strong>Strengths:</strong> [List strengths]</li><li><strong>Gaps:</strong> [List gaps]</li><li><strong>Risk Rating:</strong> <span class="pill">[Level]</span></li><li><strong>Remediation:</strong> <ul><li>[Content]</li></ul></li></ul>
      <h3>5.4 Endpoint Security</h3>
      <ul><li><strong>Strengths:</strong> [List strengths]</li><li><strong>Gaps:</strong> [List gaps]</li><li><strong>Risk Rating:</strong> <span class="pill">[Level]</span></li><li><strong>Remediation:</strong> <ul><li>[Content]</li></ul></li></ul>
      <h3>5.5 Security Monitoring</h3>
      <ul><li><strong>Strengths:</strong> [List strengths]</li><li><strong>Gaps:</strong> [List gaps]</li><li><strong>Risk Rating:</strong> <span class="pill">[Level]</span></li><li><strong>Remediation:</strong> <ul><li>[Content]</li></ul></li></ul>
      <h3>5.6 Compliance &amp; Policies</h3>
      <ul><li><strong>Strengths:</strong> [List strengths]</li><li><strong>Gaps:</strong> [List gaps]</li><li><strong>Risk Rating:</strong> <span class="pill">[Level]</span></li><li><strong>Remediation:</strong> <ul><li>[Content]</li></ul></li></ul>
    </section>
    <section class="card">
      <h2>6) Prioritized Action Plan</h2>
      <h3>6.1 Quick Wins (0–30 days)</h3>
      <ul><li>[Action 1] <div class="muted">Owner: [Role] &middot; Effort: [S/M/L] &middot; Cost: [$/$$/$$$] &middot; Impact: [High/Med/Low]</div></li><li>[Action 2] <div class="muted">Owner: [Role] &middot; Effort: [S/M/L] &middot; Cost: [$/$$/$$$]</div></li></ul>
      <h3>6.2 Near-Term (31–90 days)</h3>
      <ul><li>[Action 3] <div class="muted">Owner: [Role] &middot; Effort: [S/M/L] &middot; Impact: [High/Med/Low]</div></li></ul>
      <h3>6.3 Mid-Term (3–6 months)</h3>
      <ul><li>[Action 4] <div class="muted">Owner: [Role] &middot; Effort: [S/M/L]</div></li></ul>
      <h3>6.4 Long-Term (6–12 months)</h3>
      <ul><li>[Action 5] <div class="muted">Owner: [Role] &middot; Effort: [S/M/L]</div></li></ul>
    </section>
    <section class="card">
      <h2>7) Policy, Process, and Controls Upgrades</h2>
      <ul>
        <li>Access Control Policy: [Adopt/Update] — MFA mandate, SSO, least privilege, quarterly reviews</li>
        <li>Joiner-Mover-Leaver (JML) SOP: [Define/Automate] — provisioning, offboarding SLA</li>
        <li>Password Management SOP: [Deploy/Enforce] — enterprise password manager, shared vault policy</li>
        <li>Data Retention &amp; DSAR SOP: [Define/Document] — timelines per regime, purge workflow</li>
        <li>Backup &amp; Recovery: [Document/Test] — RPO/RTO targets, encryption, restoration drills</li>
        <li>Incident Response Plan: [Create/Refine] — triage, comms, vendor escalation, forensics</li>
        <li>Vendor Risk Management: [Implement] — DPAs, security review cadence, incident clauses</li>
        <li>PCI/Security for Payments: [Scope reduction/SAQ] — tokenization, 3DS, AVS/CVV enforcement</li>
      </ul>
    </section>
    <section class="card">
      <h2>8) Monitoring, Metrics, and Alerts</h2>
      <ul>
        <li>IAM — MFA Coverage: [Current %] &rarr; Target: [Target %]</li>
        <li>IAM — Shared Credentials: [Current count] &rarr; Target: 0</li>
        <li>Data — DSAR SLA: [Current days] &rarr; Target: [&le; days]</li>
        <li>Payments — Chargeback Rate: [Current %] &rarr; Target: [Target %]</li>
        <li>Ops — Backup Success Rate: [Current %] &rarr; Target: [Target %]</li>
        <li>Operations — Incident MTTR: [Current] &rarr; Target: [Target]</li>
        <li>Operations — Post-incident Reviews: [Current %] &rarr; Target: [Target % of P1/P2]</li>
      </ul>
    </section>
    <section class="card">
      <h2>9) Tooling &amp; Integration Recommendations</h2>
      <ul>
        <li>IAM/SSO/MFA: [e.g. Okta / Entra ID / Google Workspace] — [fit notes]</li>
        <li>Password Manager: [e.g. 1Password / LastPass Business / Bitwarden] — [deployment notes]</li>
        <li>Payments/Fraud: [e.g. Stripe Radar, Adyen 3DS, Chargeback alerts] — [policy notes]</li>
        <li>Data Protection: [DLP / encryption key mgmt / backup provider] — [notes]</li>
        <li>Monitoring/Logging: [SIEM/logging choice] — [events to capture, alert routing]</li>
        <li>Automation: [Webhook/Zapier/SCIM] — [JML/offboarding automation]</li>
      </ul>
    </section>
    <section class="card">
      <h2>10) Assumptions, Constraints, and Data Quality</h2>
      <ul><li>Missing or Unclear Inputs: [List fields not provided or "N/A"]</li><li>Assumptions Made: [List assumptions]</li><li>Confidence Level: [High/Medium/Low] — Reason: [Text]</li></ul>
    </section>
    <section class="card">
      <h2>11) Appendix: Raw Assessment Responses</h2>
      <p class="muted">Aligned to the assessment sections.</p>
      <h3>Company Information</h3>
      <ul><li>Company, Contact, Role: {{company}}, {{name}}, {{role}}</li></ul>
      <h3>Access Control</h3>
      <ul><li>Authentication, MFA, Password Policy, Access Review: [From assessment]</li></ul>
      <h3>Network Security</h3>
      <ul><li>Firewall, VPN, Segmentation, Intrusion Detection: [From assessment]</li></ul>
      <h3>Data Protection</h3>
      <ul><li>Encryption, Backups, Data Classification: [From assessment]</li></ul>
      <h3>Endpoint Security</h3>
      <ul><li>Antivirus, EDR, Patch Management, MDM: [From assessment]</li></ul>
      <h3>Security Monitoring</h3>
      <ul><li>SIEM, Log Retention, Incident Response, Vuln Scanning: [From assessment]</li></ul>
      <h3>Compliance &amp; Policies</h3>
      <ul><li>Frameworks, Policies, Training, Third-Party Risk: [From assessment]</li></ul>
      <h3>Additional Information</h3>
      <ul><li>Recent Incidents, Concerns, Comments: {{message}}</li></ul>
    </section>
  </div>
</body>
</html>`;
}

function buildStubReportHtml(submission, data) {
  const name = submission.name || submission.email || "Customer";
  const company = submission.company || "—";
  const email = submission.email || "—";
  const service = submission.service || "—";
  const message = submission.message || (data.describe_concerns || "");
  const generatedDate = new Date().toISOString().slice(0, 10);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Security Assessment Report – Flare</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #1a1a1a; }
    h1 { font-size: 1.5rem; color: #111; border-bottom: 2px solid #0969da; padding-bottom: 0.5rem; }
    .meta { color: #666; font-size: 0.875rem; margin-bottom: 1.5rem; }
    .section { margin-top: 1.5rem; }
    .section h2 { font-size: 1rem; color: #333; margin-bottom: 0.5rem; }
    .section p { margin: 0.25rem 0; }
    table.info { width: 100%; border-collapse: collapse; }
    table.info td { padding: 0.35rem 0; border-bottom: 1px solid #eee; }
    table.info td:first-child { font-weight: 500; width: 8rem; color: #555; }
    .footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #eee; color: #888; font-size: 0.8rem; }
  </style>
</head>
<body>
  <h1>Security Assessment Report</h1>
  <p class="meta">Generated ${escapeHtml(generatedDate)} by Flare. Connect AI (OpenAI/Workers AI) in the queue consumer for full analysis.</p>
  <div class="section">
    <h2>Executive summary</h2>
    <p>This report is based on your assessment submission. Below are the details we have on file. For a full risk analysis and recommendations, AI-powered report generation can be enabled in the Flare Worker.</p>
  </div>
  <div class="section">
    <h2>Contact &amp; plan</h2>
    <table class="info">
      <tr><td>Name</td><td>${escapeHtml(name)}</td></tr>
      <tr><td>Company</td><td>${escapeHtml(company)}</td></tr>
      <tr><td>Email</td><td>${escapeHtml(email)}</td></tr>
      <tr><td>Plan</td><td>${escapeHtml(service)}</td></tr>
    </table>
  </div>
  ${message ? `<div class="section"><h2>Your notes</h2><p>${escapeHtml(message)}</p></div>` : ""}
  <div class="footer">
    <p>Report generated on ${escapeHtml(generatedDate)}. Flare – Phase 4 template.</p>
  </div>
</body>
</html>`;
}

function escapeHtml(s) {
  if (s == null) return "";
  const str = String(s);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
