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

/** Email copy for welcome and report-ready emails. Locales: en, pt (Portugal), es (Spain), fr, de (Germany). */
const I18N_EMAIL = {
  en: {
    welcome_subject: "Welcome – complete your security assessment",
    welcome_title: "Welcome – Flare",
    welcome_thanks: "Thanks for your purchase. Complete your assessment to receive your report.",
    welcome_code: "Use this security code to access your assessment:",
    welcome_cta: "Open assessment",
    welcome_expires: "This link expires in 30 days.",
    report_ready_subject: "Your security assessment report is ready",
    report_ready_title: "Your report is ready – Flare",
    report_ready_body: "Your security assessment report is ready.",
    report_ready_cta: "View report",
    report_ready_expires: "This link will expire in 30 days.",
  },
  pt: {
    welcome_subject: "Bem-vindo – complete o seu questionário de segurança",
    welcome_title: "Bem-vindo – Flare",
    welcome_thanks: "Obrigado pela sua compra. Complete o questionário para receber o seu relatório.",
    welcome_code: "Use este código para aceder ao questionário:",
    welcome_cta: "Abrir questionário",
    welcome_expires: "Este link expira em 30 dias.",
    report_ready_subject: "O seu relatório de segurança está pronto",
    report_ready_title: "O seu relatório está pronto – Flare",
    report_ready_body: "O seu relatório de avaliação de segurança está pronto.",
    report_ready_cta: "Ver relatório",
    report_ready_expires: "Este link expira em 30 dias.",
  },
  es: {
    welcome_subject: "Bienvenido – complete su cuestionario de seguridad",
    welcome_title: "Bienvenido – Flare",
    welcome_thanks: "Gracias por su compra. Complete el cuestionario para recibir su informe.",
    welcome_code: "Use este código para acceder al cuestionario:",
    welcome_cta: "Abrir cuestionario",
    welcome_expires: "Este enlace caduca en 30 días.",
    report_ready_subject: "Su informe de seguridad está listo",
    report_ready_title: "Su informe está listo – Flare",
    report_ready_body: "Su informe de evaluación de seguridad está listo.",
    report_ready_cta: "Ver informe",
    report_ready_expires: "Este enlace caducará en 30 días.",
  },
  fr: {
    welcome_subject: "Bienvenue – complétez votre questionnaire de sécurité",
    welcome_title: "Bienvenue – Flare",
    welcome_thanks: "Merci pour votre achat. Complétez le questionnaire pour recevoir votre rapport.",
    welcome_code: "Utilisez ce code pour accéder au questionnaire :",
    welcome_cta: "Ouvrir le questionnaire",
    welcome_expires: "Ce lien expire dans 30 jours.",
    report_ready_subject: "Votre rapport de sécurité est prêt",
    report_ready_title: "Votre rapport est prêt – Flare",
    report_ready_body: "Votre rapport d'évaluation de sécurité est prêt.",
    report_ready_cta: "Voir le rapport",
    report_ready_expires: "Ce lien expirera dans 30 jours.",
  },
  de: {
    welcome_subject: "Willkommen – füllen Sie Ihren Sicherheitsfragebogen aus",
    welcome_title: "Willkommen – Flare",
    welcome_thanks: "Danke für Ihren Einkauf. Füllen Sie den Fragebogen aus, um Ihren Bericht zu erhalten.",
    welcome_code: "Nutzen Sie diesen Code für den Zugang zum Fragebogen:",
    welcome_cta: "Fragebogen öffnen",
    welcome_expires: "Dieser Link läuft in 30 Tagen ab.",
    report_ready_subject: "Ihr Sicherheitsbericht ist fertig",
    report_ready_title: "Ihr Bericht ist fertig – Flare",
    report_ready_body: "Ihr Bericht zur Sicherheitsbewertung ist fertig.",
    report_ready_cta: "Bericht ansehen",
    report_ready_expires: "Dieser Link läuft in 30 Tagen ab.",
  },
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

/** 6-char alphanumeric security code for assessment access (from welcome email). */
function verificationCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const arr = new Uint8Array(6);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => chars[b % chars.length])
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
  if (!customerEmail) return null;
  if (!serviceType || !ALLOWED_SERVICES.includes(serviceType)) serviceType = "core";

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
  const code = verificationCode();
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
  try {
    await db.prepare("UPDATE payments SET verification_code = ? WHERE id = ?").bind(code, result.id).run();
  } catch (_) {}
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

const RATE_LIMIT_WINDOW_MIN = 15;
const RATE_LIMIT_MAX_REQUESTS = 10;

async function checkAssessmentRateLimit(db, key) {
  try {
    const now = new Date();
    const nowStr = now.toISOString().slice(0, 19);
    const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MIN * 60 * 1000).toISOString().slice(0, 19);
    const row = await db.prepare("SELECT count, window_start FROM rate_limit_assessment WHERE key = ?").bind(key).first();
    if (!row) {
      await db.prepare("INSERT OR REPLACE INTO rate_limit_assessment (key, count, window_start) VALUES (?, 1, ?)").bind(key, nowStr).run();
      return true;
    }
    const ws = row.window_start || "";
    if (ws < windowStart) {
      await db.prepare("UPDATE rate_limit_assessment SET count = 1, window_start = ? WHERE key = ?").bind(nowStr, key).run();
      return true;
    }
    const count = (row.count || 0) + 1;
    if (count > RATE_LIMIT_MAX_REQUESTS) return false;
    await db.prepare("UPDATE rate_limit_assessment SET count = ? WHERE key = ?").bind(count, key).run();
    return true;
  } catch (_) {
    return true;
  }
}

async function verifyTurnstile(secret, token, request) {
  if (!token) return false;
  try {
    const form = new FormData();
    form.set("secret", secret);
    form.set("response", token);
    const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For");
    if (ip) form.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    return data.success === true;
  } catch (_) {
    return false;
  }
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
        let message = "";
        if (ct.includes("application/json")) {
          const body = await request.json();
          email = (body.email || "").trim();
          name = (body.name || "").trim();
          message = (body.message != null ? String(body.message) : "").trim().slice(0, 2000);
        } else if (ct.includes("application/x-www-form-urlencoded")) {
          const body = await request.formData();
          email = (body.get("email") || "").trim();
          name = (body.get("name") || "").trim();
          message = (body.get("message") != null ? String(body.get("message")) : "").trim().slice(0, 2000);
        } else {
          return json({ ok: false, error: "Content-Type must be application/json or application/x-www-form-urlencoded" }, 400);
        }
        if (!email) {
          return json({ ok: false, error: "email is required" }, 400);
        }
        const submitted_at = new Date().toISOString();
        try {
          await env.DB.prepare(
            "INSERT INTO contact_submissions (email, name, message, submitted_at, status) VALUES (?, ?, ?, ?, 'new')"
          ).bind(email, name || null, message || null, submitted_at).run();
        } catch (insertErr) {
          if (insertErr.message && /no such column: message/i.test(insertErr.message)) {
            await env.DB.prepare(
              "INSERT INTO contact_submissions (email, name, submitted_at, status) VALUES (?, ?, ?, 'new')"
            ).bind(email, name || null, submitted_at).run();
          } else {
            throw insertErr;
          }
        }
        const notifyTo = await getContactNotifyEmail(env);
        if (notifyTo && env.RESEND_API_KEY) {
          const fromName = await getFromName(env);
          const fromEmail = await getFromEmail(env);
          const from = fromEmail.includes("<") ? fromEmail : `${fromName} <${fromEmail}>`;
          const subject = "Flare – New contact form submission";
          const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:system-ui,sans-serif;padding:1rem;max-width:32rem;">
<p><strong>New message from the website contact form.</strong></p>
<p><strong>From:</strong> ${escapeHtml(name || "—")}<br><strong>Email:</strong> <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></p>
<p><strong>Message:</strong></p>
<p style="white-space:pre-wrap;background:#f4f4f5;padding:0.75rem;border-radius:6px;">${escapeHtml(message || "(no message)")}</p>
<p style="color:#71717a;font-size:0.9rem;">Reply to this email to respond directly to the sender.</p>
</body></html>`;
          try {
            await sendResend(env.RESEND_API_KEY, { from, to: notifyTo, subject, html, reply_to: email });
          } catch (_) {}
        }
        return json({ ok: true, message: "Submission saved" });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/submit") {
      if (!env.DB) return json({ ok: false, error: "Database not configured" }, 501);
      return json({ ok: false, error: "POST only" }, 405);
    }

    // ---------- Version (public, for admin footer) ----------
    if (url.pathname === "/api/version" && request.method === "GET") {
      const lastUpdated = (env.LAST_UPDATED || env.BUILD_DATE || "").toString().trim();
      const git = (env.GIT_VERSION || env.GIT_SHA || "").toString().trim();
      return json({ ok: true, lastUpdated, git });
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
        const customerEmail = (body.customer_email ?? "").toString().trim();
        if (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
          return json({ ok: false, error: "Valid customer_email is required." }, 400);
        }
        const customerName = (body.customer_name ?? "").toString().trim() || undefined;
        const currency = (body.currency ?? "eur").toString().toLowerCase();
        const allowedCurrencies = ["eur", "usd"];
        const cur = allowedCurrencies.includes(currency) ? currency : "eur";
        const workerBase = (env.WORKER_PUBLIC_URL || url.origin).replace(/\/$/, "");
        const pagesBase = (env.SUCCESS_BASE_URL || request.headers.get("Origin") || url.origin).replace(/\/$/, "");
        const successUrl = `${workerBase}/api/success?session_id={CHECKOUT_SESSION_ID}`;
        const cancelUrl = `${pagesBase}/checkout.html?canceled=1`;
        const locale = String(body.locale ?? "").trim().toLowerCase();
        const flareLocale = ["en", "pt", "pt-pt", "es", "fr", "de"].includes(locale)
          ? (locale.startsWith("pt") ? "pt" : locale === "pt-pt" ? "pt" : locale)
          : "en";
        let leadId = null;
        if (env.DB) {
          try {
            const leadResult = await env.DB.prepare(
              "INSERT INTO leads (name, email, service) VALUES (?, ?, ?)"
            ).bind(customerName || "Customer", customerEmail, serviceType).run();
            leadId = leadResult.meta?.last_row_id ?? null;
          } catch (_) {}
        }
        const session = await createCheckoutSession(stripeKey, {
          successUrl,
          cancelUrl,
          serviceType,
          currency: cur,
          customerEmail,
          customerName,
          customerCompany: body.customer_company?.trim() || undefined,
          leadId,
          locale: flareLocale,
          brandingDisplayName: env.CHECKOUT_DISPLAY_NAME?.trim() || undefined,
          brandingLogoUrl: env.CHECKOUT_LOGO_URL?.trim() || undefined,
        });
        return json({ ok: true, url: session.url, session_id: session.id });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    const isStripeWebhook = url.pathname === "/api/webhooks/stripe" || url.pathname === "/api/webhooks/stripe/";
    if (isStripeWebhook) {
      if (request.method === "GET") {
        return new Response(
          "Stripe webhook endpoint. Stripe must POST events here (checkout.session.completed triggers welcome email; payment_intent.succeeded stores email in leads when first). If you have payments in Admin but no rows in stripe_webhook_events, Stripe is not calling this URL – check Stripe Dashboard → Webhooks → endpoint URL.",
          { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } }
        );
      }
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
      if (!webhookSecret) return new Response("Webhook secret not set", { status: 500 });
      const rawBody = await request.text();
      const sigHeader = request.headers.get("Stripe-Signature") || "";
      try {
        const event = await verifyWebhook(rawBody, sigHeader, webhookSecret);
        const eventId = event.id;
        const eventType = event.type;
        let checkoutEmailError = null;

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

        if (env.DB && (eventType === "checkout.session.completed" || eventType === "payment_intent.succeeded")) {
          try {
            await env.DB.prepare(
              "INSERT INTO email_logs (payment_id, email_type, recipient_email, subject, status, error_message) VALUES (NULL, 'webhook_received', ?, ?, 'failed', ?)"
            ).bind(eventType, "Stripe " + eventType, eventId).run();
          } catch (_) {}
        }

        if (eventType === "checkout.session.completed") {
          const session = event.data?.object;
          const paymentIntentId = session?.payment_intent;
          if (!paymentIntentId || !env.STRIPE_SECRET_KEY || !env.DB) {
            return json({ received: true });
          }
          const piIdStr = typeof paymentIntentId === "string" ? paymentIntentId : paymentIntentId.id;
          const stripeKey = env.STRIPE_SECRET_KEY;
          const intent = await retrievePaymentIntent(stripeKey, piIdStr);
          const sessionEmail = (session?.customer_details?.email || session?.customer_email || "").toString().trim();
          const sessionName = (session?.customer_details?.name || "").toString().trim();
          const result = await upsertPaymentFromIntent(env.DB, intent, {
            email: sessionEmail || undefined,
            name: sessionName || undefined,
          });
          let payment = result?.row ?? null;
          if (!payment && intent?.id) {
            payment = await env.DB.prepare("SELECT * FROM payments WHERE transaction_id = ? LIMIT 1").bind(String(intent.id)).first();
          }
          if (payment?.id && env.DB) {
            const metaLocale = (session.metadata?.flare_locale || "").toString().trim().toLowerCase() || "en";
            if (result?.isNew && payment.lead_id) {
              try {
                await env.DB.prepare(
                  "UPDATE leads SET converted_at = datetime('now'), payment_id = ?, updated_at = datetime('now') WHERE id = ?"
                )
                  .bind(payment.id, parseInt(payment.lead_id, 10))
                  .run();
              } catch (_) {}
            }
            try {
              await env.DB.prepare("UPDATE payments SET customer_locale = ?, updated_at = datetime('now') WHERE id = ?")
                .bind(metaLocale.startsWith("pt") ? "pt" : metaLocale, payment.id)
                .run();
              if (sessionEmail) {
                await env.DB.prepare("UPDATE payments SET customer_email = ?, updated_at = datetime('now') WHERE id = ? AND (customer_email IS NULL OR TRIM(customer_email) = '')")
                  .bind(sessionEmail, payment.id).run();
              }
              if (sessionName) {
                await env.DB.prepare("UPDATE payments SET customer_name = ?, updated_at = datetime('now') WHERE id = ? AND (customer_name IS NULL OR TRIM(customer_name) = '')")
                  .bind(sessionName, payment.id).run();
              }
            } catch (_) {}
            // If payment still has no email, fill from lead stored by payment_intent.succeeded (which can arrive before this event)
            let paymentAfterLead = await env.DB.prepare("SELECT * FROM payments WHERE id = ?").bind(payment.id).first();
            const hasEmail = (paymentAfterLead?.customer_email || "").toString().trim();
            if (!hasEmail && piIdStr) {
              const leadByPi = await env.DB.prepare("SELECT id, email, name FROM leads WHERE stripe_payment_intent_id = ? LIMIT 1").bind(piIdStr).first();
              if (leadByPi?.email) {
                try {
                  await env.DB.prepare("UPDATE payments SET customer_email = ?, customer_name = COALESCE(NULLIF(TRIM(customer_name), ''), ?), lead_id = ?, updated_at = datetime('now') WHERE id = ?")
                    .bind(leadByPi.email, leadByPi.name || null, leadByPi.id, payment.id)
                    .run();
                  await env.DB.prepare("UPDATE leads SET payment_id = ?, converted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
                    .bind(payment.id, leadByPi.id)
                    .run();
                  paymentAfterLead = await env.DB.prepare("SELECT * FROM payments WHERE id = ?").bind(payment.id).first();
                } catch (_) {}
              }
            }
            payment = paymentAfterLead || payment;
            // Send welcome email from checkout.session.completed (payment has email from session or from leads)
            if (payment?.id && env.RESEND_API_KEY) {
              const recipient = (payment.customer_email || "").toString().trim();
              const welcomeSent = await env.DB.prepare("SELECT id FROM email_logs WHERE payment_id = ? AND email_type = 'welcome' AND status = 'sent' LIMIT 1").bind(payment.id).first();
              if (!welcomeSent && recipient) {
                const sendResult = await handleSendWelcomeEmail(env, { payment_id: payment.id, recipient_email: recipient });
                if (!sendResult.sent && sendResult.error) checkoutEmailError = sendResult.error;
              }
              const hasLog = await env.DB.prepare("SELECT id FROM email_logs WHERE payment_id = ? AND email_type = 'welcome' LIMIT 1").bind(payment.id).first();
              if (!hasLog) {
                const reason = checkoutEmailError || (recipient ? "unknown" : "no customer email (session or lead)");
                try {
                  await env.DB.prepare(
                    "INSERT INTO email_logs (payment_id, email_type, recipient_email, subject, status, error_message) VALUES (?, 'welcome', ?, ?, 'failed', ?)"
                  ).bind(payment.id, recipient || "(no email)", "Welcome (webhook)", reason).run();
                } catch (e) {
                  try {
                    await env.DB.prepare("UPDATE stripe_webhook_events SET last_error = ? WHERE event_id = ?")
                      .bind(("email_logs insert failed: " + (e && e.message || String(e))).slice(0, 500), eventId).run();
                  } catch (_) {}
                }
              }
            } else if (payment?.id && !env.RESEND_API_KEY) {
              checkoutEmailError = "RESEND_API_KEY not set";
            }
            // When payment is confirmed, remove the lead so only unsuccessful (abandoned) entries remain in leads
            const leadIdToRemove = payment?.lead_id ? parseInt(payment.lead_id, 10) : null;
            if (leadIdToRemove && env.DB) {
              try {
                await env.DB.prepare("UPDATE payments SET lead_id = NULL WHERE id = ?").bind(payment.id).run();
                await env.DB.prepare("DELETE FROM leads WHERE id = ?").bind(leadIdToRemove).run();
              } catch (_) {}
            }
          }
        } else if (eventType === "payment_intent.succeeded") {
          // Store email in leads when payment_intent.succeeded arrives first; checkout.session.completed will fill payment and send the welcome email.
          const pi = event.data?.object;
          if (pi?.id && env.DB) {
            let intent = pi;
            if (env.STRIPE_SECRET_KEY) {
              try {
                intent = await retrievePaymentIntent(env.STRIPE_SECRET_KEY, pi.id);
              } catch (_) {}
            }
            const email = (intent?.metadata?.customer_email || intent?.receipt_email || "").toString().trim();
            if (email) {
              const name = (intent?.metadata?.customer_name || "").toString().trim() || "Customer";
              let service = (intent?.metadata?.service_type || "").toString().trim();
              if (!service || !ALLOWED_SERVICES.includes(service)) service = "core";
              const piId = String(pi.id);
              try {
                const existing = await env.DB.prepare("SELECT id FROM leads WHERE stripe_payment_intent_id = ? LIMIT 1").bind(piId).first();
                if (existing) {
                  await env.DB.prepare("UPDATE leads SET email = ?, name = ?, service = ?, updated_at = datetime('now') WHERE id = ?")
                    .bind(email, name, service, existing.id).run();
                } else {
                  await env.DB.prepare(
                    "INSERT INTO leads (name, email, service, stripe_payment_intent_id) VALUES (?, ?, ?, ?)"
                  ).bind(name, email, service, piId).run();
                }
              } catch (e) {
                checkoutEmailError = "leads insert/update failed: " + (e?.message || String(e));
              }
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
              "UPDATE stripe_webhook_events SET status = 'processed', processed_at = datetime('now'), last_error = ? WHERE event_id = ?"
            )
              .bind(checkoutEmailError ? String(checkoutEmailError).slice(0, 500) : null, eventId)
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
          if (payment?.id && result?.isNew && env.RESEND_API_KEY) {
            const metaLocale = (session.metadata?.flare_locale || "").toString().trim().toLowerCase() || "en";
            try {
              await env.DB.prepare("UPDATE payments SET customer_locale = ?, updated_at = datetime('now') WHERE id = ?")
                .bind(metaLocale.startsWith("pt") ? "pt" : metaLocale, payment.id)
                .run();
            } catch (_) {}
            try {
              await handleSendWelcomeEmail(env, { payment_id: payment.id });
            } catch (_) {}
          }
        }
        if (!payment) return json({ ok: false, error: "Payment not found" }, 404);
        // Backfill customer_email from Stripe session if missing on payment (e.g. webhook ran before session had details)
        const sessionEmail = session.customer_details?.email?.trim();
        if (sessionEmail && (!payment.customer_email || !payment.customer_email.trim())) {
          try {
            await env.DB.prepare("UPDATE payments SET customer_email = ?, updated_at = datetime('now') WHERE id = ?")
              .bind(sessionEmail, payment.id).run();
            payment = { ...payment, customer_email: sessionEmail };
          } catch (_) {}
        }
        // Always send welcome email inline when user hits success page (so it doesn't depend on queue)
        const welcomeSent = await env.DB.prepare(
          "SELECT id FROM email_logs WHERE payment_id = ? AND email_type = 'welcome' AND status = 'sent' LIMIT 1"
        ).bind(payment.id).first();
        const recipientEmail = (payment.customer_email || "").trim();
        if (!welcomeSent && recipientEmail && payment.payment_status === "completed" && env.RESEND_API_KEY) {
          try {
            await handleSendWelcomeEmail(env, { payment_id: payment.id });
          } catch (_) {}
        }
        let base = (env.SUCCESS_BASE_URL || request.headers.get("Origin") || url.origin).replace(/\/$/, "");
        if (base.includes("workers.dev")) base = (env.SUCCESS_BASE_URL || "https://getflare.net").replace(/\/$/, "");
        const metaLocale = (session.metadata?.flare_locale || "").toLowerCase();
        const successPathByLocale = { pt: "pt/success.html", es: "es/success.html", fr: "fr/success.html", de: "de/success.html" };
        const successPath = successPathByLocale[metaLocale] || (metaLocale.startsWith("pt") ? "pt/success.html" : "success.html");
        const redirectUrl = `${base}/${successPath}?hash=${encodeURIComponent(payment.access_hash)}`;
        return Response.redirect(redirectUrl, 302);
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/api/success") {
      return json({ ok: false, error: "Success endpoint requires DB and Stripe" }, 503);
    }

    // ---------- Assessment link verification (hash + code) ----------
    if (url.pathname === "/api/assessment-verify" && request.method === "GET" && env.DB) {
      const hash = url.searchParams.get("hash") || url.searchParams.get("h") || "";
      const code = (url.searchParams.get("code") || "").trim().toUpperCase();
      if (!hash) return json({ ok: false, error: "hash required" }, 400);
      if (!code) return json({ ok: false, error: "code required" }, 400);
      try {
        const payment = await env.DB.prepare(
          "SELECT id, access_hash, verification_code, expires_at FROM payments WHERE access_hash = ? AND payment_status = 'completed' LIMIT 1"
        ).bind(hash).first();
        if (!payment) return json({ ok: false, error: "Invalid link" }, 404);
        if (payment.expires_at && payment.expires_at < new Date().toISOString().slice(0, 19)) {
          return json({ ok: false, error: "Link expired" }, 410);
        }
        const storedCode = (payment.verification_code || "").trim().toUpperCase();
        if (!storedCode || storedCode !== code) return json({ ok: false, error: "Invalid security code" }, 401);
        return json({ ok: true });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    // ---------- Phase 2: Assessments ----------
    if (url.pathname === "/api/assessments" && request.method === "POST" && env.DB) {
      try {
        const body = await request.json().catch(() => ({}));
        const accessHash = (body.access_hash ?? body.hash ?? "").trim();
        const paymentId = body.payment_id != null ? parseInt(body.payment_id, 10) : null;
        const verificationCode = (body.verification_code ?? body.code ?? "").trim().toUpperCase();
        let payment = null;
        if (accessHash) {
          payment = await env.DB.prepare(
            "SELECT id, service_type, expires_at, verification_code FROM payments WHERE access_hash = ? AND payment_status = 'completed' LIMIT 1"
          ).bind(accessHash).first();
        }
        if (!payment && paymentId) {
          payment = await env.DB.prepare(
            "SELECT id, service_type, expires_at, verification_code FROM payments WHERE id = ? AND payment_status = 'completed' LIMIT 1"
          ).bind(paymentId).first();
        }
        if (payment && payment.expires_at && payment.expires_at < new Date().toISOString().slice(0, 19)) {
          return json({ ok: false, error: "Assessment link has expired" }, 410);
        }
        if (payment) {
          const storedCode = (payment.verification_code || "").trim().toUpperCase();
          if (storedCode && storedCode !== verificationCode) {
            return json({ ok: false, error: "Invalid or missing security code" }, 401);
          }
        }
        const rateLimitKey = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
        const rateLimitOk = await checkAssessmentRateLimit(env.DB, rateLimitKey);
        if (!rateLimitOk) return json({ ok: false, error: "Too many attempts. Please try again later." }, 429);
        if (env.TURNSTILE_SECRET_KEY && body.captcha_token) {
          const turnstileOk = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, body.captcha_token, request);
          if (!turnstileOk) return json({ ok: false, error: "Security check failed. Please try again." }, 400);
        }
        const serviceType = (payment?.service_type ?? "core").toString();
        const name = (body.contact_name ?? body.name ?? "").trim();
        const email = (body.email ?? "").trim();
        const company = (body.company_name ?? body.company ?? "").trim();
        if (!email) return json({ ok: false, error: "email is required" }, 400);
        const message = (body.message ?? body.describe_concerns ?? "").trim().slice(0, 2000);
        const assessmentData = typeof body.assessment_data === "object" ? JSON.stringify(body.assessment_data) : (body.assessment_data ?? "{}");
        const submittedAt = new Date().toISOString().slice(0, 19).replace("T", " ");
        const pid = payment?.id ?? paymentId;

        // One submission per payment: if this payment already has a submission, do not insert or re-trigger job
        if (pid != null) {
          const existing = await env.DB.prepare(
            "SELECT id FROM contact_submissions WHERE payment_id = ? LIMIT 1"
          )
            .bind(pid)
            .first();
          if (existing) {
            return json({
              ok: true,
              already_submitted: true,
              message: "You have already submitted your assessment for this purchase. Your report is being generated or has been sent.",
              submission_id: existing.id,
            });
          }
        }

        try {
          await env.DB.prepare(
            `INSERT INTO contact_submissions (name, email, company, service, payment_id, message, assessment_data, form_version, submitted_at, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`
          )
            .bind(name || null, email, company || null, serviceType, pid ?? null, message || null, assessmentData, "2.0", submittedAt)
            .run();
        } catch (insertErr) {
          const msg = String(insertErr?.message ?? insertErr);
          if (pid != null && (msg.includes("UNIQUE") || msg.includes("constraint"))) {
            return json({
              ok: true,
              already_submitted: true,
              message: "You have already submitted your assessment for this purchase. Your report is being generated or has been sent.",
            });
          }
          throw insertErr;
        }

        const row = await env.DB.prepare("SELECT id FROM contact_submissions WHERE email = ? AND submitted_at = ? ORDER BY id DESC LIMIT 1")
          .bind(email, submittedAt)
          .first();
        const submissionId = row?.id ?? null;

        if (submissionId && env.JOBS && pid) {
          try {
            await env.JOBS.send({
              type: "generate_report",
              submission_id: submissionId,
              payment_id: pid,
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
          "SELECT id, name, email, company, service, payment_id, submitted_at, status FROM contact_submissions WHERE payment_id IS NOT NULL ORDER BY id DESC LIMIT ?"
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
          env.DB.prepare("SELECT COUNT(*) as n FROM contact_submissions WHERE payment_id IS NOT NULL").first(),
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

    if (url.pathname === "/api/admin/contact-notify-status" && request.method === "GET" && env.DB) {
      const admin = await requireAdmin(request, env);
      if (!admin) return json({ error: "Unauthorized" }, 401);
      try {
        const email = await getContactNotifyEmail(env);
        if (!email) return json({ ok: true, configured: false });
        const at = email.indexOf("@");
        const redacted = at > 0 ? (email[0] + "***" + email.slice(at)) : "***";
        return json({ ok: true, configured: true, email: redacted });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    if (url.pathname === "/api/admin/test-contact-email" && request.method === "POST" && env.DB) {
      const admin = await requireAdmin(request, env);
      if (!admin) return json({ error: "Unauthorized" }, 401);
      if (!env.RESEND_API_KEY) return json({ ok: false, error: "RESEND_API_KEY is not set" }, 503);
      const notifyTo = await getContactNotifyEmail(env);
      if (!notifyTo) return json({ ok: false, error: "CONTACT_NOTIFY_EMAIL is not set. Add it as a Worker secret (e.g. mail@strsecure.com)." }, 503);
      try {
        const fromName = await getFromName(env);
        const fromEmail = await getFromEmail(env);
        const from = fromEmail.includes("<") ? fromEmail : `${fromName} <${fromEmail}>`;
        const subject = "Flare – contact notifications test";
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:system-ui,sans-serif;padding:1rem;"><p>Contact form notifications are configured. You will receive an email here when someone submits the website Contact form.</p><p><strong>Flare</strong></p></body></html>`;
        const result = await sendResend(env.RESEND_API_KEY, { from, to: notifyTo, subject, html });
        if (result.error) return json({ ok: false, error: result.error }, 502);
        return json({ ok: true, id: result.id });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === "/api/admin/test-email" && request.method === "POST" && env.DB) {
      const admin = await requireAdmin(request, env);
      if (!admin) return json({ error: "Unauthorized" }, 401);
      if (!env.RESEND_API_KEY) return json({ ok: false, error: "RESEND_API_KEY is not set" }, 503);
      try {
        const body = await request.json().catch(() => ({}));
        const to = (body.to ?? "").trim();
        if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json({ ok: false, error: "Valid 'to' email required in body" }, 400);
        const fromName = await getFromName(env);
        const fromEmail = await getFromEmail(env);
        const from = fromEmail.includes("<") ? fromEmail : `${fromName} <${fromEmail}>`;
        const subject = "Flare – email test";
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:system-ui,sans-serif;padding:1rem;"><p>If you received this, Resend is working.</p><p><strong>Flare</strong></p></body></html>`;
        const result = await sendResend(env.RESEND_API_KEY, { from, to, subject, html });
        if (result.error) return json({ ok: false, error: result.error }, 502);
        return json({ ok: true, id: result.id });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === "/api/admin/chart-data" && request.method === "GET" && env.DB) {
      const admin = await requireAdmin(request, env);
      if (!admin) return json({ error: "Unauthorized" }, 401);
      let month = url.searchParams.get("month") || "";
      if (!/^\d{4}-\d{2}$/.test(month)) {
        const now = new Date();
        month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      }
      const first = `${month}-01`;
      const year = parseInt(month.slice(0, 4), 10);
      const monthIndex = parseInt(month.slice(5, 7), 10) - 1;
      const nextMonthDate = new Date(year, monthIndex + 1, 1);
      const nextMonth = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}-01`;
      const lastDay = new Date(year, monthIndex + 1, 0).getDate();
      const monthLabel = new Date(year, monthIndex).toLocaleDateString("en-US", { month: "long", year: "numeric" });
      try {
        let rows;
        try {
          rows = await env.DB.prepare(
            `SELECT cast(strftime('%d', created_at) as integer) as day, COUNT(*) as cnt, COALESCE(SUM(amount), 0) / 100.0 as rev
             FROM payments WHERE payment_status = 'completed' AND created_at >= ? AND created_at < ?
             GROUP BY day ORDER BY day`
          ).bind(first, nextMonth).all();
        } catch (colErr) {
          if (String(colErr?.message || "").includes("amount")) {
            rows = await env.DB.prepare(
              `SELECT cast(strftime('%d', created_at) as integer) as day, COUNT(*) as cnt, COALESCE(SUM(amount_cents), 0) / 100.0 as rev
               FROM payments WHERE payment_status = 'completed' AND created_at >= ? AND created_at < ?
               GROUP BY day ORDER BY day`
            ).bind(first, nextMonth).all();
          } else throw colErr;
        }
        const byDay = {};
        for (const r of rows.results || []) {
          byDay[r.day] = { purchases: r.cnt | 0, revenue: Math.round((r.rev || 0) * 100) / 100 };
        }
        const labels = [];
        const purchases = [];
        const revenue = [];
        for (let d = 1; d <= lastDay; d++) {
          labels.push(String(d));
          purchases.push(byDay[d]?.purchases ?? 0);
          revenue.push(byDay[d]?.revenue ?? 0);
        }
        return json({ ok: true, month, monthLabel, labels, purchases, revenue });
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
            const errMsg = String(colErr?.message || colErr || "").toLowerCase();
            if (errMsg.includes("no such column") && errMsg.includes("body")) {
              return json({
                ok: false,
                error: "Assessment HTML could not be saved: the database is missing the 'body' column. Run this migration in your Flare project: npx wrangler d1 execute flare-db --remote --file=./migrations/006_assessment_template_body.sql",
              }, 503);
            }
            if (templateBody !== null) throw colErr;
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

    if (url.pathname === "/api/admin/settings" && env.DB) {
      const admin = await requireAdmin(request, env);
      if (!admin) return json({ error: "Unauthorized" }, 401);
      if (request.method === "GET") {
        try {
          const claudeKey = await getSetting(env.DB, "claude_api_key");
          const aiInstruction = await getSetting(env.DB, "ai_report_instruction");
          return json({
            ok: true,
            claude_api_key_set: !!(claudeKey && String(claudeKey).trim()),
            ai_report_instruction: aiInstruction ?? "",
            ai_report_instruction_default: getDefaultAIReportInstruction(),
          });
        } catch (e) {
          return json({ ok: true, claude_api_key_set: false, ai_report_instruction: "", ai_report_instruction_default: getDefaultAIReportInstruction() });
        }
      }
      if (request.method === "PUT" || request.method === "POST") {
        try {
          const body = await request.json().catch(() => ({}));
          if (body.claude_api_key !== undefined) {
            const val = String(body.claude_api_key ?? "").trim();
            await env.DB.prepare(
              "INSERT INTO automation_settings (setting_key, setting_value, updated_at) VALUES ('claude_api_key', ?, datetime('now')) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = datetime('now')"
            ).bind(val).run();
          }
          if (body.ai_report_instruction !== undefined) {
            const val = String(body.ai_report_instruction ?? "");
            await env.DB.prepare(
              "INSERT INTO automation_settings (setting_key, setting_value, updated_at) VALUES ('ai_report_instruction', ?, datetime('now')) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = datetime('now')"
            ).bind(val).run();
          }
          return json({ ok: true, message: "Settings saved" });
        } catch (e) {
          return json({ error: e.message }, 500);
        }
      }
      return json({ error: "Method not allowed" }, 405);
    }

    if (url.pathname === "/api/admin/report-template" && env.DB) {
      const admin = await requireAdmin(request, env);
      if (!admin) return json({ error: "Unauthorized" }, 401);
      if (request.method === "GET") {
        try {
          const row = await env.DB.prepare("SELECT body, updated_at FROM report_templates WHERE id = 1 LIMIT 1").first();
          const body = row?.body ?? null;
          const defaultBody = getDefaultReportTemplateBody();
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
  const claudeApiKey = (await getSetting(env.DB, "claude_api_key")) || env.CLAUDE_API_KEY || env.ANTHROPIC_API_KEY || "";
  if (claudeApiKey) {
    try {
      const aiVars = await callClaudeForReport(claudeApiKey, env, submission, data, reportVars);
      Object.assign(reportVars, aiVars);
    } catch (_) {}
  }
  let htmlContent = "";
  try {
    const templateRow = await env.DB.prepare("SELECT body FROM report_templates WHERE id = 1 AND body IS NOT NULL AND body != '' LIMIT 1").first();
    const lang = (reportVars.language || "").toString().toLowerCase();
    const isPt = lang === "pt" || lang === "pt-pt";
    const defaultBody = isPt ? getDefaultReportTemplateBodyFlarePT() : getDefaultReportTemplateBody();
    const templateBody = templateRow?.body ? templateRow.body : defaultBody;
    htmlContent = applyReportTemplate(templateBody, reportVars);
  } catch (_) {
    const lang = (reportVars.language || "").toString().toLowerCase();
    const isPt = lang === "pt" || lang === "pt-pt";
    htmlContent = applyReportTemplate(isPt ? getDefaultReportTemplateBodyFlarePT() : getDefaultReportTemplateBody(), reportVars);
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

/** Normalize email locale to I18N_EMAIL key: en, pt, es, fr, de. */
function emailLocaleKey(locale) {
  const k = (locale || "").toString().toLowerCase();
  if (k === "pt" || k === "pt-pt") return "pt";
  if (k === "es") return "es";
  if (k === "fr") return "fr";
  if (k === "de") return "de";
  return "en";
}

/** Email HTML in website style (Outfit, Flare colors). locale: en | pt | es | fr | de (default en). */
function getWelcomeEmailHtml(name, assessmentUrl, fromName, codeBlock, locale = "en") {
  const key = emailLocaleKey(locale);
  const t = I18N_EMAIL[key] || I18N_EMAIL.en;
  return `<!DOCTYPE html><html lang="${key}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(t.welcome_title)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet"></head><body style="margin:0;font-family:'Outfit',system-ui,sans-serif;background:#0a0a0b;color:#e4e4e7;line-height:1.6;padding:2rem 1rem;">
<div style="max-width:36em;margin:0 auto;">
  <p style="margin:0 0 1rem;font-size:1.25rem;font-weight:600;background:linear-gradient(135deg,#fb923c,#22d3ee);-webkit-background-clip:text;color:transparent;">Flare.</p>
  <p style="margin:0 0 1rem;">Hi ${escapeHtml(name)},</p>
  <p style="margin:0 0 1rem;">${t.welcome_thanks}</p>
  ${codeBlock || ""}
  <p style="margin:1rem 0;"><a href="${escapeHtml(assessmentUrl)}" style="display:inline-block;padding:0.75rem 1.5rem;background:linear-gradient(135deg,#22d3ee,#06b6d4);color:#0a0a0b;text-decoration:none;font-weight:600;border-radius:10px;">${t.welcome_cta}</a></p>
  <p style="margin:1.5rem 0 0;color:#71717a;font-size:0.9rem;">${t.welcome_expires}</p>
  <p style="margin:2rem 0 0;color:#71717a;font-size:0.85rem;">— ${escapeHtml(fromName)}</p>
</div></body></html>`;
}

function getReportReadyEmailHtml(name, reportUrl, fromName, locale = "en") {
  const key = emailLocaleKey(locale);
  const t = I18N_EMAIL[key] || I18N_EMAIL.en;
  return `<!DOCTYPE html><html lang="${key}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(t.report_ready_title)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet"></head><body style="margin:0;font-family:'Outfit',system-ui,sans-serif;background:#0a0a0b;color:#e4e4e7;line-height:1.6;padding:2rem 1rem;">
<div style="max-width:36em;margin:0 auto;">
  <p style="margin:0 0 1rem;font-size:1.25rem;font-weight:600;background:linear-gradient(135deg,#fb923c,#22d3ee);-webkit-background-clip:text;color:transparent;">Flare.</p>
  <p style="margin:0 0 1rem;">Hi ${escapeHtml(name)},</p>
  <p style="margin:0 0 1rem;">${t.report_ready_body}</p>
  <p style="margin:1rem 0;"><a href="${escapeHtml(reportUrl)}" style="display:inline-block;padding:0.75rem 1.5rem;background:linear-gradient(135deg,#22d3ee,#06b6d4);color:#0a0a0b;text-decoration:none;font-weight:600;border-radius:10px;">${t.report_ready_cta}</a></p>
  <p style="margin:1.5rem 0 0;color:#71717a;font-size:0.9rem;">${t.report_ready_expires}</p>
  <p style="margin:2rem 0 0;color:#71717a;font-size:0.85rem;">— ${escapeHtml(fromName)}</p>
</div></body></html>`;
}

async function getFromEmail(env) {
  if (env.FROM_EMAIL) return env.FROM_EMAIL;
  try {
    const row = await env.DB.prepare("SELECT setting_value FROM automation_settings WHERE setting_key = 'from_email' LIMIT 1").first();
    return row?.setting_value || "Flare <noreply@getflare.net>";
  } catch (_) {
    return "Flare <noreply@getflare.net>";
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

/** Email address to receive contact form notifications (env.CONTACT_NOTIFY_EMAIL or D1 automation_settings contact_notify_email). */
async function getContactNotifyEmail(env) {
  if (env.CONTACT_NOTIFY_EMAIL) {
    const v = String(env.CONTACT_NOTIFY_EMAIL).trim();
    if (v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return v;
  }
  try {
    const row = await env.DB.prepare("SELECT setting_value FROM automation_settings WHERE setting_key = 'contact_notify_email' LIMIT 1").first();
    const v = row?.setting_value?.trim();
    if (v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return v;
  } catch (_) {}
  return null;
}

/**
 * Send welcome email (assessment link + code) via Resend. Used only from Stripe webhook.
 * @returns {{ sent: boolean, error?: string }}
 */
async function handleSendWelcomeEmail(env, body) {
  const paymentId = body.payment_id ? parseInt(body.payment_id, 10) : 0;
  if (!paymentId || !env.RESEND_API_KEY) return { sent: false, error: !env.RESEND_API_KEY ? "RESEND_API_KEY not set" : "no payment_id" };
  const payment = await env.DB.prepare(
    "SELECT id, customer_email, customer_name, access_hash, verification_code, service_type, payment_status, customer_locale FROM payments WHERE id = ?"
  ).bind(paymentId).first();
  if (!payment || payment.payment_status !== "completed") return { sent: false, error: !payment ? "payment not found" : "payment not completed" };
  const to = (body.recipient_email || payment.customer_email || "").toString().trim();
  if (!to) return { sent: false, error: "no customer_email on payment" };
  const alreadySent = await env.DB.prepare(
    "SELECT id FROM email_logs WHERE payment_id = ? AND email_type = 'welcome' AND status = 'sent' LIMIT 1"
  ).bind(paymentId).first();
  if (alreadySent) return { sent: true };
  const base = (env.SUCCESS_BASE_URL || env.WORKER_PUBLIC_URL || "https://getflare.net").replace(/\/$/, "");
  const rawLocale = (payment.customer_locale || "en").toString().trim().toLowerCase();
  const locale = emailLocaleKey(rawLocale);
  const assessmentPathByLocale = { en: "assessment.html", pt: "pt/assessment.html", es: "es/assessment.html", fr: "fr/assessment.html", de: "de/assessment.html" };
  const assessmentPath = assessmentPathByLocale[locale] || assessmentPathByLocale.en;
  const assessmentUrl = `${base}/${assessmentPath}?hash=${encodeURIComponent(payment.access_hash || "")}`;
  const name = payment.customer_name || "there";
  const code = payment.verification_code || "";
  const fromName = await getFromName(env);
  const fromEmail = await getFromEmail(env);
  const from = fromEmail.includes("<") ? fromEmail : `${fromName} <${fromEmail}>`;
  const t = I18N_EMAIL[locale] || I18N_EMAIL.en;
  const subject = t.welcome_subject;
  const codeBlock = code
    ? `<p>${t.welcome_code} <strong style="font-size:1.1em;letter-spacing:0.15em;">${escapeHtml(code)}</strong></p>`
    : "";
  const html = getWelcomeEmailHtml(name, assessmentUrl, fromName, codeBlock, locale);
  const result = await sendResend(env.RESEND_API_KEY, { from, to, subject, html });
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  try {
    await env.DB.prepare(
      "INSERT INTO email_logs (payment_id, email_type, recipient_email, subject, status, sent_at, error_message) VALUES (?, 'welcome', ?, ?, ?, ?, ?)"
    ).bind(paymentId, to, subject, result.error ? "failed" : "sent", result.error ? null : now, result.error || null).run();
  } catch (e) {
    return { sent: false, error: (result.error || "db log failed: " + (e && e.message || String(e))) };
  }
  return result.error ? { sent: false, error: result.error } : { sent: true };
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
  let reportLocale = "en";
  if (report.submission_id) {
    try {
      const sub = await env.DB.prepare("SELECT assessment_data FROM assessment_submissions WHERE id = ?").bind(report.submission_id).first();
      if (sub?.assessment_data) {
        const data = typeof sub.assessment_data === "string" ? JSON.parse(sub.assessment_data || "{}") : sub.assessment_data || {};
        const lang = (data.report_language || data.language || "").toString().toLowerCase();
        reportLocale = emailLocaleKey(lang);
      }
    } catch (_) {}
  }
  const workerBase = (env.WORKER_PUBLIC_URL || "https://flare-worker.gusmao-ricardo.workers.dev").replace(/\/$/, "");
  const reportUrl = `${workerBase}/report?hash=${encodeURIComponent(report.view_hash)}`;
  const fromName = await getFromName(env);
  const fromEmail = await getFromEmail(env);
  const from = fromEmail.includes("<") ? fromEmail : `${fromName} <${fromEmail}>`;
  const reportT = I18N_EMAIL[reportLocale] || I18N_EMAIL.en;
  const subject = reportT.report_ready_subject;
  const html = getReportReadyEmailHtml(name, reportUrl, fromName, reportLocale);
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

async function callClaudeForReport(apiKey, env, submission, data, reportVars) {
  const systemInstruction =
    (await getSetting(env.DB, "ai_report_instruction")) ||
    getDefaultAIReportInstruction();
  const prompt = `Assessment submission:\nCompany: ${reportVars.company}\nContact: ${reportVars.name} (${reportVars.email})\nRole: ${reportVars.role}\nService: ${reportVars.service}\nNotes: ${reportVars.message}\n\nRaw assessment data (JSON):\n${typeof data === "string" ? data : JSON.stringify(data)}\n\nProduce the JSON object only.`;
  const model = env.CLAUDE_MODEL || "claude-sonnet-4-20250514";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      system: systemInstruction,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) return {};
  const out = await res.json();
  const contentBlock = out.content?.find((b) => b.type === "text");
  const content = (contentBlock?.text || "").trim();
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    return {
      ai_executive_summary: parsed.executive_summary || "",
      ai_findings: parsed.findings || "",
      ai_recommendations: parsed.recommendations || "",
    };
  } catch (_) {
    return { ai_executive_summary: content.slice(0, 500) };
  }
}

async function getSetting(db, key) {
  try {
    const row = await db.prepare("SELECT setting_value FROM automation_settings WHERE setting_key = ? LIMIT 1").bind(key).first();
    return row?.setting_value ?? null;
  } catch (_) {
    return null;
  }
}

/** Default system instruction for Claude when generating report content. Used when ai_report_instruction is not set in DB. */
function getDefaultAIReportInstruction() {
  return `You are a security advisor for micro and small businesses and solo founders. Your job is to turn their assessment answers into a short, actionable Flare Compass report.

## Goal
- Help them see their main risks in plain language and in order of priority.
- Tell them exactly what to do next, with clear steps and links to free, reliable guides.
- No jargon: explain like you would to a smart non-technical business owner. Avoid acronyms unless you spell them out once (e.g. "multi-factor authentication (MFA)").

## Output
Produce a JSON object with exactly these keys (you may use HTML in findings and recommendations; escape quotes inside strings):
- executive_summary: 2–3 sentences. What is the overall picture? What should they focus on first?
- findings: HTML list (e.g. <ul><li>...</li></ul>) of 3–5 main gaps or risks. One short sentence per finding; say why it matters to their business.
- recommendations: HTML list of 3–5 prioritized actions. Each item must be practical and include a step-by-step link where possible. Prefer free tools and free guides only.

## Rules
- Only recommend free or low-cost options. Do not recommend paid software, audits, or consultants unless the assessment clearly states they have budget and want that. Default to free tools and free guides only.
- Use these categories of free tools when relevant:
  - Antivirus / endpoint: Windows Defender (built-in), built-in Mac protection, OpenEDR (free EDR).
  - Email and accounts: Google's 2-Step Verification and account security, Microsoft account security.
  - Websites: Cloudflare (free tier) for DNS, DDoS protection, and optional WAF.
  - Encryption: BitLocker (Windows), FileVault (Mac), device encryption on mobile.
  - Passwords: Bitwarden (free tier), or browser/OS built-in password managers.
- For every recommendation, add a direct link to an official or widely trusted step-by-step guide (e.g. Google's "Turn on 2-Step Verification", Microsoft's "Turn on BitLocker", Cloudflare's "Add a site", OpenEDR documentation). Use <a href="URL">link text</a> in the HTML.
- Order recommendations by impact and ease: do the most important, quick wins first.
- Base everything on the assessment data provided; do not invent answers they did not give. If something is "Not sure", say so and still give a simple next step (e.g. "Check whether MFA is on: [link]").
- Keep tone supportive and practical: "Here is what to do" not "You should have done this."
- Write the entire JSON (executive_summary, findings, recommendations) in the same language as the assessment. If the assessment is in English, write in English; if in Portuguese, Spanish, French, or German, write in that language.`;
}

/** Escape string for use in RegExp (so {{a.contact_name}} works). */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyReportTemplate(templateBody, vars) {
  let out = templateBody;
  for (const [key, value] of Object.entries(vars)) {
    const str = value != null ? String(value) : "";
    const safe = key.startsWith("ai_") || key.endsWith("_html") ? str : escapeHtml(str);
    const pattern = `\\{\\{${escapeRegExp(key)}\\}\\}`;
    out = out.replace(new RegExp(pattern, "g"), safe);
  }
  return out;
}

/** Get array from assessment data; form may send key or "key[]". */
function getArr(d, key) {
  const v = d[key] ?? d[key + "[]"];
  return Array.isArray(v) ? v : v != null ? [v] : [];
}

/** Count "Not sure" in key control fields for confidence. */
function countNotSure(data, keys) {
  const d = data || {};
  let n = 0;
  for (const k of keys) {
    const v = d[k] ?? d[k + "[]"];
    const s = Array.isArray(v) ? v.join(" ") : (v != null ? String(v) : "");
    if (/not\s*sure/i.test(s)) n += 1;
  }
  return n;
}

function buildReportVars(submission, data) {
  const d = data || {};
  const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const join = (v) => arr(v).join(", ") || "—";
  const str = (v) => (v != null && String(v).trim() !== "" ? String(v).trim() : "—");
  const reportDate = new Date().toISOString().slice(0, 10);
  const nameVal = str(submission.name) !== "—" ? str(submission.name) : str(d.contact_name) || str(submission.email) || "Customer";
  const companyVal = str(submission.company) || str(d.company_name);
  const emailVal = str(submission.email) || str(d.email);
  const roleVal = str(d.role);
  const messageVal = str(submission.message) !== "—" ? str(submission.message) : str(d.describe_concerns);
  const publicWebsite = str(d.public_website);
  const websiteUrlRaw = str(d.website_url || d.website);
  const hasWebsite = publicWebsite === "Yes" && websiteUrlRaw !== "—" && websiteUrlRaw !== "";
  const websiteHref = hasWebsite ? websiteUrlRaw : "#";
  const websiteDisplay = hasWebsite ? websiteUrlRaw : "No public website";
  const website_cell_html = hasWebsite
    ? `<a href="${escapeHtml(websiteHref)}" target="_blank" rel="noopener">${escapeHtml(websiteUrlRaw)}</a>`
    : "No public website";
  const peopleRange = str(d.number_of_people);
  const workSetup = str(d.work_location);
  const primaryRegion = str(d.data_hosted) || join(getArr(d, "operating_regions"));
  const language = str(d.report_language) || str(d.language) || "—";
  const timeline = str(d.improvements_timeline);
  const budget_range = str(d.budget_range);
  const acceptPayments = str(d.accept_payments);
  const paymentsApplicable = acceptPayments === "Yes";
  const websiteApplicable = publicWebsite === "Yes";
  const byodVal = str(d.byod);
  const byodApplicable = byodVal === "Yes" || byodVal === "Some roles";
  const pastIncidentsArr = getArr(d, "past_incidents");
  const hadIncidents = pastIncidentsArr.length > 0 && !pastIncidentsArr.every((x) => /^none$/i.test(String(x).trim()));

  const notSureKeys = [
    "mfa_email", "mfa_other_tools", "share_passwords", "password_manager", "backup_method", "backup_tested",
    "updates_handled", "who_receives_alerts", "devices_encrypted", "customer_data_request"
  ];
  const notSureCount = countNotSure(d, notSureKeys);
  const confidenceLevel = notSureCount <= 1 ? "High" : notSureCount <= 4 ? "Medium" : "Low";

  const customerDataList = getArr(d, "customer_data");
  const employeeDataList = getArr(d, "employee_data");
  const hasSensitiveData = customerDataList.some((x) => /payment|health|financial|id\s*doc|children/i.test(String(x)))
    || employeeDataList.some((x) => /tax|ssn|bank|payroll|health/i.test(String(x)));
  const dataSensitivitySummary = hasSensitiveData ? "Handles sensitive data (e.g. payment, health, or identity)" : "General business data";

  const vars = {
    name: nameVal,
    company: companyVal,
    email: emailVal,
    role: roleVal,
    service: str(submission.service),
    message: messageVal,
    report_date: reportDate,
    website_url: websiteDisplay,
    website_href: websiteHref,
    website_cell_html,
    people_range: peopleRange,
    work_setup: workSetup,
    primary_region: primaryRegion,
    units_range: peopleRange,
    countries: primaryRegion,
    language,
    timeline,
    budget_range,
    public_website: publicWebsite,
    website_platform: str(d.website_platform),
    website_admin_access: str(d.website_admin_access),
    website_updates: str(d.website_updates),
    mfa_email: str(d.mfa_email),
    mfa_critical: str(d.mfa_other_tools),
    shared_passwords: str(d.share_passwords),
    password_manager: str(d.password_manager),
    admin_access: str(d.admin_access),
    offboarding_speed: str(d.offboard_speed),
    account_recovery: str(d.account_recovery),
    tool_owner_list: str(d.accounts_inventory),
    login_count: str(d.login_count),
    outside_access: join(getArr(d, "outside_access")),
    vpn_usage: str(d.vpn),
    wifi_security: str(d.wifi_security),
    guest_wifi: str(d.guest_wifi),
    customer_data_types: join(getArr(d, "customer_data")),
    employee_data_types: join(getArr(d, "employee_data")),
    data_locations: join(getArr(d, "important_data_stored")),
    data_retention: str(d.delete_data),
    dsar_readiness: str(d.customer_data_request),
    device_encryption: str(d.devices_encrypted),
    secure_sharing: str(d.secure_file_sharing),
    privacy_notice: str(d.privacy_policy),
    limit_sensitive_access: str(d.limit_sensitive_access),
    backup_status: str(d.backup_method),
    backup_frequency: str(d.backup_frequency),
    backup_tested: str(d.backup_tested),
    backup_data: join(getArr(d, "backup_data")),
    endpoint_protection: str(d.computer_protection),
    update_cadence: str(d.updates_handled),
    screen_lock: str(d.screen_lock),
    byod: byodVal,
    byod_requirements: str(d.byod_protections),
    device_inventory: str(d.device_inventory),
    alerts_enabled: join(getArr(d, "security_alerts")),
    alert_owner: str(d.who_receives_alerts),
    incident_checklist: str(d.hack_checklist),
    incident_contacts: join(getArr(d, "first_call")),
    past_incidents: join(getArr(d, "past_incidents")),
    incident_details: str(d.incident_details),
    legal_contract_requirements: str(d.legal_requirements),
    customer_security_requests: join(getArr(d, "customer_security_ask")),
    dpa_usage: str(d.dpa_with_vendors),
    vendor_security_check: str(d.vendor_security_check),
    training_cadence: str(d.security_training),
    phishing_tests: str(d.phishing_tests),
    cyber_insurance: str(d.cyber_insurance),
    security_checkups: str(d.security_checkup),
    ai_executive_summary: "",
    ai_findings: "",
    ai_recommendations: "",
    website_applicable: websiteApplicable ? "Yes" : "No",
    payments_applicable: paymentsApplicable ? "Yes" : "No",
    byod_applicable: byodApplicable ? "Yes" : "No",
    had_incidents: hadIncidents ? "Yes" : "No",
    data_sensitivity_summary: dataSensitivitySummary,
    tools_count: str(d.tools_count),
    industry: str(d.industry),
    top_concerns_list: join(getArr(d, "top_concerns")),
    store_work_files_list: join(getArr(d, "store_work_files")),
    chat_meet_list: join(getArr(d, "chat_meet")),
    other_tools_list: join(getArr(d, "other_tools")),
    email_provider: str(d.email_provider),
    accept_payments: acceptPayments,
    how_accept_payments: str(d.how_accept_payments),
    card_numbers_direct: str(d.card_numbers_direct),
    store_card_details: str(d.store_card_details),
    fraud_protection_list: join(getArr(d, "fraud_protection")),
    payment_scam_attempt: str(d.payment_scam_attempt),
    amount_lost: str(d.amount_lost),
    "meta.report_date": reportDate,
    "meta.confidence_level": confidenceLevel,
    "meta.not_sure_count": String(notSureCount),
    "a.contact_name": str(d.contact_name) || nameVal,
    "a.company_name": str(d.company_name) || companyVal,
    "a.email": str(d.email) || emailVal,
    "a.role": str(d.role),
    "a.number_of_people": peopleRange,
    "a.work_location": workSetup,
    "a.public_website": publicWebsite,
    "a.website_url": websiteDisplay,
    "a.website_platform": str(d.website_platform),
    "a.website_admin_access": str(d.website_admin_access),
    "a.website_updates": str(d.website_updates),
    "a.tools_count": str(d.tools_count),
    "a.industry": str(d.industry),
    "a.store_work_files_list": join(getArr(d, "store_work_files")),
    "a.chat_meet_list": join(getArr(d, "chat_meet")),
    "a.other_tools_list": join(getArr(d, "other_tools")),
    "a.login_count": str(d.login_count),
    "a.outside_access_list": join(getArr(d, "outside_access")),
    "a.share_passwords": str(d.share_passwords),
    "a.mfa_email": str(d.mfa_email),
    "a.mfa_other_tools": str(d.mfa_other_tools),
    "a.password_manager": str(d.password_manager),
    "a.admin_access": str(d.admin_access),
    "a.offboard_speed": str(d.offboard_speed),
    "a.screen_lock": str(d.screen_lock),
    "a.account_recovery": str(d.account_recovery),
    "a.accounts_inventory": str(d.accounts_inventory),
    "a.customer_data_list": join(getArr(d, "customer_data")),
    "a.employee_data_list": join(getArr(d, "employee_data")),
    "a.important_data_stored_list": join(getArr(d, "important_data_stored")),
    "a.delete_data": str(d.delete_data),
    "a.customer_data_request": str(d.customer_data_request),
    "a.data_hosted": str(d.data_hosted),
    "a.devices_encrypted": str(d.devices_encrypted),
    "a.secure_file_sharing": str(d.secure_file_sharing),
    "a.privacy_policy": str(d.privacy_policy),
    "a.limit_sensitive_access": str(d.limit_sensitive_access),
    "a.accept_payments": acceptPayments,
    "a.how_accept_payments": str(d.how_accept_payments),
    "a.card_numbers_direct": str(d.card_numbers_direct),
    "a.store_card_details": str(d.store_card_details),
    "a.fraud_protection_list": join(getArr(d, "fraud_protection")),
    "a.payment_scam_attempt": str(d.payment_scam_attempt),
    "a.amount_lost": str(d.amount_lost),
    "a.byod": byodVal,
    "a.byod_protections": str(d.byod_protections),
    "a.vpn": str(d.vpn),
    "a.wifi_security": str(d.wifi_security),
    "a.guest_wifi": str(d.guest_wifi),
    "a.computer_protection": str(d.computer_protection),
    "a.updates_handled": str(d.updates_handled),
    "a.device_inventory": str(d.device_inventory),
    "a.security_alerts_list": join(getArr(d, "security_alerts")),
    "a.who_receives_alerts": str(d.who_receives_alerts),
    "a.hack_checklist": str(d.hack_checklist),
    "a.first_call_list": join(getArr(d, "first_call")),
    "a.past_incidents_list": join(getArr(d, "past_incidents")),
    "a.incident_details": str(d.incident_details),
    "a.backup_method": str(d.backup_method),
    "a.backup_data_list": join(getArr(d, "backup_data")),
    "a.backup_frequency": str(d.backup_frequency),
    "a.backup_tested": str(d.backup_tested),
    "a.legal_requirements": str(d.legal_requirements),
    "a.customer_security_ask_list": join(getArr(d, "customer_security_ask")),
    "a.dpa_with_vendors": str(d.dpa_with_vendors),
    "a.vendor_security_check": str(d.vendor_security_check),
    "a.security_training": str(d.security_training),
    "a.phishing_tests": str(d.phishing_tests),
    "a.cyber_insurance": str(d.cyber_insurance),
    "a.security_checkup": str(d.security_checkup),
    "a.top_concerns_list": join(getArr(d, "top_concerns")),
    "a.describe_concerns": str(d.describe_concerns),
    "a.improvements_timeline": timeline,
    "a.budget_range": budget_range,
    "a.website_applicable": websiteApplicable ? "Yes" : "No",
    "a.payments_applicable": paymentsApplicable ? "Yes" : "No",
    "a.byod_applicable": byodApplicable ? "Yes" : "No",
    "a.had_incidents": hadIncidents ? "Yes" : "No",
  };
  return vars;
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
  <title>Flare Compass – Security Report</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script>document.documentElement.setAttribute('data-theme', localStorage.getItem('flare_theme') || 'dark');</script>
  <style>
    :root, [data-theme="dark"] { --bg: #0a0a0b; --bg-card: #111113; --text: #e4e4e7; --muted: #71717a; --accent: #22d3ee; --border: rgba(255,255,255,0.06); --pill-low: #10b981; --pill-mod: #f59e0b; --pill-high: #f97316; --pill-crit: #ef4444; }
    [data-theme="light"] { --bg: #f4f4f5; --bg-card: #ffffff; --text: #18181b; --muted: #71717a; --accent: #0891b2; --border: rgba(0,0,0,0.08); --pill-low: #059669; --pill-mod: #d97706; --pill-high: #ea580c; --pill-crit: #dc2626; }
    [data-theme="light"] body, [data-theme="light"] .report { background: #f4f4f5; }
    [data-theme="light"] .card, [data-theme="light"] section.card { background: #ffffff; }
    [data-theme="light"] .kpi { background: #f4f4f5; }
    html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: 'Outfit', system-ui, sans-serif; line-height: 1.55; }
    .report { max-width: 960px; margin: 32px auto 64px; padding: 0 16px; }
    .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 16px; }
    .report-header { background: linear-gradient(135deg, #0e7490 0%, #0891b2 50%, #22d3ee 100%); color: #fff; padding: 28px 24px; border-radius: 14px; margin-bottom: 18px; }
    .report-header h1 { margin: 0 0 8px; font-size: 26px; font-weight: 700; }
    .report-header .subtitle { margin: 0; color: rgba(255,255,255,0.9); font-size: 14px; }
    .report-hero { text-align: center; padding: 2.5rem 1.5rem 2rem; border-bottom: 1px solid var(--border); margin-bottom: 1.5rem; }
    .report-hero .report-hero-logo { font-weight: 700; font-size: 1.5rem; letter-spacing: -0.02em; margin-bottom: 1rem; }
    .report-hero .report-hero-logo .w { background: linear-gradient(135deg, #f59e0b, #22d3ee); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .report-hero .report-hero-logo .d { color: #22c55e; }
    .report-hero h1 { font-size: 1.75rem; margin: 0 0 0.5rem; font-weight: 700; color: var(--text); }
    .report-hero .report-hero-tagline { margin: 0; font-size: 1rem; color: var(--muted); line-height: 1.5; }
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
    .cover-page { min-height: 60vh; display: flex; flex-direction: column; justify-content: center; padding: 48px 24px; text-align: center; }
    .cover-page h1 { font-size: 28px; margin: 0 0 24px; }
    .cover-page .meta { font-size: 15px; line-height: 1.8; color: var(--muted); }
    .cover-page .confidential { margin-top: 32px; font-size: 13px; color: var(--muted); }
    .snapshot-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--border); }
    .snapshot-status { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
    .snapshot-status.ok { background: var(--pill-low); }
    .snapshot-status.warn { background: var(--pill-mod); }
    .snapshot-status.gap { background: var(--pill-high); }
    table.report-table { width: 100%; border-collapse: collapse; font-size: 14px; }
    table.report-table th, table.report-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
    table.report-table th { color: var(--muted); font-weight: 600; }
    .section-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
    a { color: var(--accent); }
    @media (max-width: 720px) { .meta-grid, .grid-2, .kv { grid-template-columns: 1fr; } }
    @media print { body { background: #fff; color: #111; } .card, .report-header { box-shadow: none; } .pill { print-color-adjust: exact; } }
  </style>
</head>
<body>
  <div class="report">
    <section class="report-hero">
      <div class="report-hero-logo"><span class="w">Flare</span><span class="d">.</span></div>
      <h1>Flare Compass</h1>
      <p class="report-hero-tagline">Your risks in order, with clear steps to fix them yourself.</p>
    </section>
    <header class="report-header" style="display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px;">
      <div>
        <h1>Security & Operations Risk Assessment Report</h1>
        <p class="subtitle">Prepared for {{name}} · {{company}} · {{report_date}} · Flare · getflare.net</p>
      </div>
      <button type="button" id="theme-toggle" aria-label="Toggle dark/light mode" style="background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.5); color: #fff; padding: 0.4rem 0.75rem; border-radius: 8px; cursor: pointer; font-size: 0.875rem; font-family: inherit; white-space: nowrap;">Dark</button>
    </header>
    <section class="card cover-page">
      <p class="meta"><strong>{{company}}</strong></p>
      <p class="meta">Prepared for {{name}}, {{role}}</p>
      <p class="meta">Date generated: {{meta.report_date}}</p>
      <p class="confidential">This report is confidential and intended for the addressee. Do not distribute without permission.</p>
      <p class="muted" style="margin-top:16px;font-size:12px;">Version 1 · Inputs: assessment data (sections 1–10), {{meta.report_date}}</p>
    </section>
    <section class="card">
      <div class="section-title"><h2>1) Report Metadata &amp; Scope</h2></div>
      <div class="meta-grid">
        <div class="kv"><label>Company</label><div>{{company}}</div></div>
        <div class="kv"><label>Website status</label><div>{{website_cell_html}}</div></div>
        <div class="kv"><label>Website platform</label><div>{{website_platform}}</div></div>
        <div class="kv"><label>Prepared for</label><div>{{name}} — {{role}}</div></div>
        <div class="kv"><label>Prepared by</label><div>Flare</div></div>
        <div class="kv"><label>Date generated</label><div>{{report_date}}</div></div>
        <div class="kv"><label>Team size</label><div>{{people_range}} people using company systems</div></div>
        <div class="kv"><label>Work setup</label><div>{{work_setup}}</div></div>
        <div class="kv"><label>Tools footprint</label><div>{{tools_count}} online tools (approx)</div></div>
        <div class="kv"><label>Data sensitivity (summary)</label><div>{{data_sensitivity_summary}}</div></div>
        <div class="kv"><label>Assessment confidence</label><div>{{meta.confidence_level}} ({{meta.not_sure_count}} &quot;Not sure&quot; on key controls)</div></div>
      </div>
      <p class="muted" style="margin-top:10px;">Website details shown only when public website = Yes. Primary region: {{primary_region}}. Language: {{language}}.</p>
    </section>
    <section class="card">
      <h2>2) Executive Summary (Decision-Ready)</h2>
      <h3>2.1 Overall posture</h3>
      <p class="muted">Two dimensions: Prevention Readiness (accounts, devices, website hardening) and Recovery Readiness (backups, restore test, incident checklist).</p>
      <div class="grid-2">
        <div class="kpi"><div>Prevention Readiness</div><div><span class="pill">[Low / Moderate / High / Critical]</span></div></div>
        <div class="kpi"><div>Recovery Readiness</div><div><span class="pill">[Low / Moderate / High / Critical]</span></div></div>
      </div>
      <p><strong>Overall rating:</strong> [Short explanation based on {{mfa_email}}, {{backup_status}}, {{alert_owner}}, {{update_cadence}}].</p>
      <p><strong>Top 3 business risks (plain language):</strong> e.g. email takeover, ransomware downtime, invoice fraud — derived from {{top_concerns_list}} and control gaps.</p>
      <h3>2.2 Top 5 findings (with impact)</h3>
      <p class="muted">For each: What&apos;s happening · Why it matters · Evidence (QIDs) · Fix priority (Now / Next / Later).</p>
      <ul>
        <li><strong>1.</strong> [Finding] — Impact: [business]. Evidence: [QIDs]. Priority: Now/Next/Later.</li>
        <li><strong>2.</strong> [Finding] — Impact: [business]. Evidence: [QIDs]. Priority: Now/Next/Later.</li>
        <li><strong>3–5.</strong> [From {{mfa_email}}, {{shared_passwords}}, {{backup_tested}}, {{alert_owner}}, {{update_cadence}}, {{fraud_protection_list}}].</li>
      </ul>
      <h3>2.3 7-Day Quick Wins</h3>
      <ul>
        <li>Turn on MFA for email</li>
        <li>Assign alert owner ({{alert_owner}})</li>
        <li>Run 1 restore test (current: {{backup_tested}})</li>
        <li>Enable auto-updates where possible (current: {{update_cadence}})</li>
        <li>Stop password sharing; introduce password manager (current sharing: {{shared_passwords}})</li>
      </ul>
      <h3>2.4 30/60/90-day priorities</h3>
      <p class="muted">Timeline from assessment: {{timeline}}. Budget: {{budget_range}}. Owner role, effort (S/M/L), cost (Free/Low/Med), disruption (Low/Med).</p>
      <ul>
        <li><strong>Week 1–2:</strong> MFA everywhere; assign alert owner; enable alerts.</li>
        <li><strong>Week 3–4:</strong> Password manager; backup + 1 restore test.</li>
        <li><strong>Month 2:</strong> Offboarding checklist; reduce admin accounts; device encryption + updates.</li>
        <li><strong>Month 3:</strong> Tool/account list; vendor check before purchase; security checkup.</li>
      </ul>
      {{ai_executive_summary}}
      <div class="ai-findings">{{ai_findings}}</div>
      <div class="ai-recommendations">{{ai_recommendations}}</div>
    </section>
    <section class="card">
      <h2>3) One-Page Security Snapshot (Shareable Internally)</h2>
      <p class="muted">Green = in place, Yellow = partial, Red = gap. Use for internal alignment.</p>
      <h3>Accounts &amp; sign-in</h3>
      <div class="snapshot-row"><span class="snapshot-status ok"></span><span>MFA on email: {{mfa_email}}</span></div>
      <div class="snapshot-row"><span class="snapshot-status ok"></span><span>MFA on key tools: {{mfa_critical}}</span></div>
      <div class="snapshot-row"><span class="snapshot-status ok"></span><span>Password sharing: {{shared_passwords}} (target: Never)</span></div>
      <div class="snapshot-row"><span class="snapshot-status ok"></span><span>Password manager: {{password_manager}}</span></div>
      <div class="snapshot-row"><span class="snapshot-status ok"></span><span>Admin access spread: {{admin_access}}</span></div>
      <h3>Devices</h3>
      <div class="snapshot-row"><span class="snapshot-status ok"></span><span>Updates: {{update_cadence}}</span></div>
      <div class="snapshot-row"><span class="snapshot-status ok"></span><span>Device encryption: {{device_encryption}}</span></div>
      <div class="snapshot-row"><span class="snapshot-status ok"></span><span>Endpoint protection: {{endpoint_protection}}</span></div>
      <div class="snapshot-row"><span class="snapshot-status ok"></span><span>Device inventory: {{device_inventory}}</span></div>
      <h3>Backups</h3>
      <div class="snapshot-row"><span class="snapshot-status ok"></span><span>Method: {{backup_status}} — Frequency: {{backup_frequency}} — Restore tested: {{backup_tested}}</span></div>
      <h3>Alerts &amp; readiness</h3>
      <div class="snapshot-row"><span class="snapshot-status ok"></span><span>Alerts enabled: {{alerts_enabled}}</span></div>
      <div class="snapshot-row"><span class="snapshot-status ok"></span><span>Alert owner: {{alert_owner}}</span></div>
      <div class="snapshot-row"><span class="snapshot-status ok"></span><span>Incident checklist: {{incident_checklist}}</span></div>
      <div class="snapshot-row"><span class="snapshot-status ok"></span><span>Who to call first: {{incident_contacts}}</span></div>
      <h3>Payments (if applicable)</h3>
      <p class="muted">Shown when accept_payments = Yes (current: {{a.payments_applicable}}).</p>
      <div class="snapshot-row"><span class="snapshot-status ok"></span><span>Fraud controls: {{fraud_protection_list}}</span></div>
      <div class="snapshot-row"><span class="snapshot-status ok"></span><span>Card handling / scam history: {{payment_scam_attempt}} — {{amount_lost}}</span></div>
      <h3>Website (if applicable)</h3>
      <p class="muted">Shown when public_website = Yes (current: {{a.website_applicable}}).</p>
      <div class="snapshot-row"><span class="snapshot-status ok"></span><span>Platform: {{website_platform}} — Admin access: {{website_admin_access}} — Updates: {{website_updates}}</span></div>
    </section>
    <section class="card">
      <h2>4) Environment Profile (From Assessment)</h2>
      <p class="muted">Aligned to the assessment sections.</p>
      <h3>3.1 Company Information</h3>
      <ul>
        <li>Company Name: {{company}}</li>
        <li>Contact: {{name}} — {{email}}</li>
        <li>Role: {{role}}</li>
        <li>Public website: {{public_website}}</li>
        <li>Website platform: {{website_platform}}</li>
        <li>Website admin access: {{website_admin_access}}</li>
        <li>Website updates: {{website_updates}}</li>
      </ul>
      <h3>3.2 Access Control</h3>
      <ul>
        <li>Logins/users count: {{login_count}}</li>
        <li>Outside access: {{outside_access}}</li>
        <li>MFA on email: {{mfa_email}}</li>
        <li>MFA on important tools: {{mfa_critical}}</li>
        <li>Password sharing: {{shared_passwords}}</li>
        <li>Password manager use: {{password_manager}}</li>
        <li>Admin access spread: {{admin_access}}</li>
        <li>Offboarding speed: {{offboarding_speed}}</li>
        <li>Account recovery readiness: {{account_recovery}}</li>
        <li>List of important tools + owners: {{tool_owner_list}}</li>
      </ul>
      <h3>3.3 Network Security</h3>
      <ul>
        <li>Work setup: {{work_setup}}</li>
        <li>VPN usage: {{vpn_usage}}</li>
        <li>Office Wi‑Fi security: {{wifi_security}}</li>
        <li>Guest Wi‑Fi separation: {{guest_wifi}}</li>
      </ul>
      <h3>3.4 Data Protection</h3>
      <ul>
        <li>Customer data types handled: {{customer_data_types}}</li>
        <li>Employee data types stored: {{employee_data_types}}</li>
        <li>Storage locations: {{data_locations}}</li>
        <li>Data deletion/retention approach: {{data_retention}}</li>
        <li>Customer data request readiness (find/delete): {{dsar_readiness}}</li>
        <li>Device encryption: {{device_encryption}}</li>
        <li>Secure file sharing practice: {{secure_sharing}}</li>
        <li>Privacy policy/notice: {{privacy_notice}}</li>
        <li>Limit who can access sensitive data: {{limit_sensitive_access}}</li>
        <li>Backups: {{backup_status}} — Frequency: {{backup_frequency}} — Restore tested: {{backup_tested}}</li>
      </ul>
      <h3>3.5 Endpoint Security</h3>
      <ul>
        <li>Endpoint protection: {{endpoint_protection}}</li>
        <li>Updates/patching: {{update_cadence}}</li>
        <li>Device encryption: {{device_encryption}}</li>
        <li>Screen lock: {{screen_lock}}</li>
        <li>BYOD allowed: {{byod}} — Required protections: {{byod_requirements}}</li>
        <li>Device inventory exists: {{device_inventory}}</li>
      </ul>
      <h3>3.6 Alerts &amp; Incident Readiness</h3>
      <ul>
        <li>Alerts enabled: {{alerts_enabled}}</li>
        <li>Alert owner assigned: {{alert_owner}}</li>
        <li>Incident checklist exists: {{incident_checklist}}</li>
        <li>Who to contact first: {{incident_contacts}}</li>
        <li>Past incidents: {{past_incidents}}</li>
        <li>Incident details: {{incident_details}}</li>
      </ul>
      <h3>3.7 Compliance &amp; Policies</h3>
      <ul>
        <li>Legal/contract requirements known: {{legal_contract_requirements}}</li>
        <li>Customer security requests: {{customer_security_requests}}</li>
        <li>DPA usage: {{dpa_usage}}</li>
        <li>Vendor security check before purchase: {{vendor_security_check}}</li>
        <li>Training cadence: {{training_cadence}}</li>
        <li>Phishing simulations: {{phishing_tests}}</li>
        <li>Cyber insurance status: {{cyber_insurance}}</li>
        <li>Security checkup frequency: {{security_checkups}}</li>
      </ul>
      <h3>3.8 Additional Information</h3>
      <ul>
        <li>Past incidents / details: {{incident_details}}</li>
        <li>Security concerns: {{message}}</li>
      </ul>
    </section>
    <section class="card">
      <h2>5) Scoring &amp; Method (Transparent)</h2>
      <h3>5.1 How scoring works</h3>
      <p>Scale 0–5: 0=Not implemented, 1=Ad-hoc, 2=Basic, 3=Defined, 4=Managed, 5=Optimized. Areas weighted more: email MFA, backups + restore test, automatic updates, alert ownership.</p>
      <h3>5.2 Domain scores (aligned to assessment)</h3>
      <div class="grid-2">
        <div class="kpi"><div>Accounts &amp; Access (Section 3)</div><div><span class="pill">[x/5]</span></div></div>
        <div class="kpi"><div>Devices &amp; Updates (Section 6 + 3.9, 4.7)</div><div><span class="pill">[x/5]</span></div></div>
        <div class="kpi"><div>Data &amp; Privacy Basics (Section 4)</div><div><span class="pill">[x/5]</span></div></div>
        <div class="kpi"><div>Alerts &amp; Incident Readiness (Section 7)</div><div><span class="pill">[x/5]</span></div></div>
        <div class="kpi"><div>Payments &amp; Fraud (Section 5, conditional)</div><div><span class="pill">[x/5]</span></div></div>
        <div class="kpi"><div>Legal / Vendors / Training (Section 8)</div><div><span class="pill">[x/5]</span></div></div>
      </div>
      <h3>5.3 Confidence score</h3>
      <p>Based on &quot;Not sure&quot; count ({{meta.not_sure_count}}), unanswered optional fields, and skipped vs N/A. This report: <strong>{{meta.confidence_level}}</strong>.</p>
    </section>
    <section class="card">
      <h2>6) Findings by Domain (Evidence → Impact → Fix)</h2>
      <p class="muted">Per domain: Strengths · Gaps · Business impact · Evidence (QIDs) · Recommendations · Verification.</p>
      <h3>6.1 Accounts &amp; Access</h3>
      <ul><li><strong>Strengths:</strong> {{mfa_email}}, {{password_manager}}, {{admin_access}}</li><li><strong>Gaps:</strong> MFA not everywhere, password sharing ({{shared_passwords}}), no password manager</li><li><strong>Business impact:</strong> Account takeover, invoice fraud</li><li><strong>Evidence:</strong> 3.4 MFA email = {{a.mfa_email}}; 3.3 sharing = {{a.share_passwords}}; 3.6 password manager = {{a.password_manager}}</li><li><strong>Recommendations:</strong> MFA everywhere; Bitwarden; stop sharing. <strong>Verify:</strong> All key tools show MFA enabled; no shared logins.</li></ul>
      <h3>6.2 Devices &amp; Updates</h3>
      <ul><li><strong>Strengths:</strong> {{endpoint_protection}}, {{screen_lock}}, {{device_encryption}}</li><li><strong>Gaps:</strong> Updates ({{update_cadence}}), device inventory ({{device_inventory}})</li><li><strong>Evidence:</strong> 6.8 updates = {{a.updates_handled}}; 6.9 inventory = {{a.device_inventory}}</li><li><strong>Recommendations:</strong> Automatic updates; simple device list. <strong>Verify:</strong> OS set to auto-update; list of who has which device.</li></ul>
      <h3>6.3 Data &amp; Privacy Basics</h3>
      <ul><li><strong>Strengths:</strong> {{backup_status}}, {{backup_frequency}}, {{dsar_readiness}}, {{limit_sensitive_access}}</li><li><strong>Gaps:</strong> Restore tested ({{backup_tested}}), retention ({{data_retention}})</li><li><strong>Evidence:</strong> 7.10 backup_tested = {{a.backup_tested}}; 4.4 delete_data = {{a.delete_data}}</li><li><strong>Recommendations:</strong> Run one restore test; document retention. <strong>Verify:</strong> Restore test done; retention note in place.</li></ul>
      <h3>6.4 Alerts &amp; Incident Readiness</h3>
      <ul><li><strong>Strengths:</strong> {{alerts_enabled}}, {{alert_owner}}, {{incident_checklist}}, {{incident_contacts}}</li><li><strong>Gaps:</strong> Owner assigned ({{alert_owner}}); written checklist ({{incident_checklist}})</li><li><strong>Evidence:</strong> 7.1–7.4 alerts, owner, checklist, first_call</li><li><strong>Recommendations:</strong> Assign one person; one-page &quot;hacked account&quot; checklist. <strong>Verify:</strong> Name in doc; checklist in shared drive.</li></ul>
      <h3>6.5 Payments &amp; Fraud Controls (conditional)</h3>
      <p class="muted">Shown when accept_payments = Yes. Inputs: 5.2–5.7.</p>
      <ul><li><strong>Strengths:</strong> {{fraud_protection_list}}</li><li><strong>Gaps:</strong> Card handling ({{card_numbers_direct}}), scam history ({{payment_scam_attempt}})</li><li><strong>Evidence:</strong> 5.5 fraud_protection; 5.6 payment_scam_attempt; 5.7 amount_lost</li><li><strong>Recommendations:</strong> No card numbers by email/text; use processor alerts. <strong>Verify:</strong> Policy + alerts on.</li></ul>
      <h3>6.6 Legal, Vendors, Training &amp; Insurance</h3>
      <ul><li><strong>Strengths:</strong> {{legal_contract_requirements}}, {{training_cadence}}, {{cyber_insurance}}, {{vendor_security_check}}</li><li><strong>Gaps:</strong> DPA usage ({{dpa_usage}}); security checkup ({{security_checkups}})</li><li><strong>Evidence:</strong> Section 8 fields</li><li><strong>Recommendations:</strong> Vendor check before purchase; DPAs when customers ask. <strong>Verify:</strong> Checklist used; DPAs on file.</li></ul>
    </section>
    <section class="card">
      <h2>7) Playbooks (Step-by-Step &quot;How To Fix&quot;)</h2>
      <p class="muted">Goal · Steps (5–10) · Time estimate · Free/low-cost tools · Verification. Generated conditionally from gaps.</p>
      <ul>
        <li><strong>Enforce MFA everywhere:</strong> Email + key tools. Steps: Enable in Google/Microsoft admin; require for all. Time: 1–2 hrs. Tool: Built-in. Verify: No login without MFA.</li>
        <li><strong>Stop password sharing + password manager:</strong> Steps: Choose Bitwarden/1Password; create vault; migrate shared to vault; revoke shared. Time: 2–4 hrs. Verify: No shared logins.</li>
        <li><strong>Backup + restore test:</strong> Steps: Confirm backup method ({{backup_status}}); run one restore; document. Time: 1–2 hrs. Verify: Restore test date recorded.</li>
        <li><strong>Alerts + owner:</strong> Steps: Turn on login/bank/payment alerts; name owner ({{alert_owner}}). Time: &lt;1 hr. Verify: Owner in doc.</li>
        <li><strong>Offboarding checklist:</strong> Same-day access removal (current: {{offboarding_speed}}). Steps: List accounts; disable same day; document. Verify: Checklist used.</li>
        <li><strong>Device baseline:</strong> Auto-updates, screen lock, encryption. Time: 2–4 hrs. Verify: Settings checked.</li>
        <li><strong>Vendor quick security check:</strong> Before buying: who has access, where data lives, contract. Verify: Checklist in procurement.</li>
      </ul>
    </section>
    <section class="card">
      <h2>8) Conditional Deep-Dives</h2>
      <h3>8.1 Website Security (if {{a.website_applicable}} = Yes)</h3>
      <p>Platform: {{website_platform}}. Admin access: {{website_admin_access}}. Update owner: {{website_updates}}. Tips: WordPress → auto-updates + plugin hygiene; Shopify/Wix → review access; use Cloudflare free where possible.</p>
      <h3>8.2 Payments &amp; Invoice Fraud (if {{a.payments_applicable}} = Yes)</h3>
      <p>How you accept: {{how_accept_payments}}. Avoid: receiving card numbers via email/text. Fraud controls: {{fraud_protection_list}}. Scam history: {{payment_scam_attempt}} — {{amount_lost}}. Safer flow: use processor; enable alerts; two-person for large.</p>
      <h3>8.3 BYOD (if {{a.byod_applicable}} = Yes)</h3>
      <p>BYOD: {{byod}}. Required protections: {{byod_requirements}}. Minimum: work profile or separate account; screen lock; no full device control needed for SMB.</p>
      <h3>8.4 Incident Learning (if {{a.had_incidents}} = Yes)</h3>
      <p>Past incidents: {{past_incidents}}. Details: {{incident_details}}. Use to improve: prevent (MFA, backups), detect (alerts), recover (checklist, who to call).</p>
    </section>
    <section class="card">
      <h2>9) Prioritized Roadmap (Dependencies + Ownership)</h2>
      <p class="muted">Target timeline: {{timeline}}. Budget: {{budget_range}}. Conditional: no website → omit website tasks; no payments → omit payment tasks.</p>
      <table class="report-table">
        <thead><tr><th>Task</th><th>Why it matters</th><th>Owner (role)</th><th>Effort</th><th>Cost</th><th>Dependencies</th><th>Target</th></tr></thead>
        <tbody>
          <tr><td>Enable MFA (email + tools)</td><td>Prevent account takeover</td><td>IT / Owner</td><td>S</td><td>Free</td><td>—</td><td>Week 1–2</td></tr>
          <tr><td>Assign alert owner</td><td>Someone sees alerts</td><td>Owner</td><td>S</td><td>Free</td><td>—</td><td>Week 1</td></tr>
          <tr><td>Password manager + stop sharing</td><td>No shared credentials</td><td>Owner</td><td>M</td><td>Low</td><td>Pick tool first</td><td>Month 1</td></tr>
          <tr><td>Backup + 1 restore test</td><td>Recovery works</td><td>Owner</td><td>M</td><td>Free–Low</td><td>—</td><td>Month 1–2</td></tr>
          <tr><td>Offboarding checklist</td><td>Same-day access removal</td><td>HR / Owner</td><td>S</td><td>Free</td><td>—</td><td>Month 2</td></tr>
          <tr><td>Auto-updates + device list</td><td>Patched devices</td><td>IT / Owner</td><td>M</td><td>Free</td><td>—</td><td>Month 2–3</td></tr>
          <tr><td>Vendor check before purchase</td><td>Third-party risk</td><td>Who buys</td><td>S</td><td>Free</td><td>—</td><td>Ongoing</td></tr>
        </tbody>
      </table>
    </section>
    <section class="card">
      <h2>10) Tooling Recommendations (Free-First, Fit to Stack)</h2>
      <p class="muted">By environment: email provider, file storage, endpoint, backups. &quot;Why this tool&quot; · Setup highlights · Expected cost (incl. $0).</p>
      <ul>
        <li><strong>Email:</strong> {{email_provider}} — Use built-in MFA and security settings (Google Admin / Microsoft 365). Cost: $0 with existing subscription.</li>
        <li><strong>File storage:</strong> {{store_work_files_list}} — Ensure sharing rules and backup; avoid local-only critical data. Cost: $0–Low.</li>
        <li><strong>Endpoint:</strong> {{endpoint_protection}} — Prefer built-in (Windows Security / macOS) + auto-updates before paid EDR. Cost: $0.</li>
        <li><strong>Backups:</strong> {{backup_status}} — {{backup_frequency}}. Run restore test. Cost: $0 (cloud) or Low (backup tool).</li>
        <li><strong>Password manager:</strong> Bitwarden (free team tier) or 1Password. Cost: $0–Low.</li>
        <li><strong>Website (if applicable):</strong> {{website_platform}} — Auto-updates, limit admins, Cloudflare free. Cost: $0.</li>
        <li><strong>Payments (if applicable):</strong> Use processor alerts; no card by email. Cost: $0.</li>
      </ul>
    </section>
    <section class="card">
      <h2>11) Customer-Ready Security Summary (Externally Shareable)</h2>
      <p class="muted">Short section they can send to customers/prospects. Only include items supported by their answers (no over-claiming).</p>
      <ul>
        <li><strong>Controls in place:</strong> MFA ({{mfa_email}} email; {{mfa_critical}} other tools); password manager ({{password_manager}}); backups ({{backup_status}}, {{backup_frequency}}); restore tested ({{backup_tested}}); alerts ({{alerts_enabled}}); alert owner ({{alert_owner}}); device encryption ({{device_encryption}}); updates ({{update_cadence}}).</li>
        <li><strong>Data handling:</strong> {{data_sensitivity_summary}}. Storage: {{data_locations}}. Retention: {{data_retention}}. Customer data requests: {{dsar_readiness}}.</li>
        <li><strong>Training / insurance:</strong> Training ({{training_cadence}}); cyber insurance ({{cyber_insurance}}); security checkups ({{security_checkups}}).</li>
        <li><strong>Contact for security questions:</strong> {{email}}</li>
      </ul>
    </section>
    <section class="card">
      <h2>12) Assumptions, Constraints &amp; Data Quality</h2>
      <ul>
        <li><strong>Skipped (Not applicable):</strong> Payment questions if no payments; website questions if no public website; BYOD if no personal devices. Normal.</li>
        <li><strong>Unknown (&quot;Not sure&quot;):</strong> {{meta.not_sure_count}} key controls with &quot;Not sure&quot; — reduces confidence. Re-assess those when known.</li>
        <li><strong>Missing inputs:</strong> Any blank required fields affect accuracy; optional blanks are OK.</li>
        <li><strong>Confidence:</strong> {{meta.confidence_level}}. Recommended re-assessment: 90 days or after major changes.</li>
      </ul>
    </section>
    <section class="card">
      <h2>Quick wins callout</h2>
      <p><strong>Biggest risk reducers:</strong> MFA everywhere + backups + automatic updates. These three cut most SMB risk from account takeover, ransomware, and lost data.</p>
      <p><strong>If you do only 3 things this month:</strong> (1) Turn on MFA for email. (2) Assign one person to receive security alerts. (3) Run one backup restore test.</p>
      <p class="muted"><strong>Mini glossary:</strong> MFA = multi-factor authentication (second step to sign in). Phishing = fake emails/links to steal credentials. Backup restore test = actually restoring a file from backup to confirm it works.</p>
    </section>
    <section class="card">
      <h2>13) Appendices</h2>
      <h3>13.1 Templates (Copy/Paste)</h3>
      <p class="muted">Incident checklist · Offboarding checklist · Vendor security checklist · Backup checklist · Simple password/MFA policy (1 page). Available on request or from Flare.</p>
      <h3>13.2 Raw Responses (Traceable)</h3>
      <p class="muted">Traceability: QID-style references support Evidence in Section 5.</p>
      <h3>Company Information</h3>
      <ul><li>Company: {{company}} — Contact: {{name}} — Role: {{role}} — Public website: {{public_website}} — Platform: {{website_platform}} — Updates: {{website_updates}}</li></ul>
      <h3>Access Control (Section 3)</h3>
      <ul><li>MFA email: {{mfa_email}} — MFA other tools: {{mfa_critical}} — Password sharing: {{shared_passwords}} — Password manager: {{password_manager}} — Admin access: {{admin_access}} — Offboarding: {{offboarding_speed}} — Account recovery: {{account_recovery}} — Tool/account list: {{tool_owner_list}}</li></ul>
      <h3>Network (Section 6)</h3>
      <ul><li>Work setup: {{work_setup}} — VPN: {{vpn_usage}} — Wi‑Fi: {{wifi_security}} — Guest Wi‑Fi: {{guest_wifi}}</li></ul>
      <h3>Data Protection (Section 4)</h3>
      <ul><li>Customer data: {{customer_data_types}} — Employee data: {{employee_data_types}} — Stored where: {{data_locations}} — Retention: {{data_retention}} — DSAR readiness: {{dsar_readiness}} — Encryption: {{device_encryption}} — Secure sharing: {{secure_sharing}} — Privacy notice: {{privacy_notice}} — Backups: {{backup_status}} / {{backup_frequency}} / {{backup_tested}}</li></ul>
      <h3>Endpoint (Sections 3, 6)</h3>
      <ul><li>Protection: {{endpoint_protection}} — Updates: {{update_cadence}} — Screen lock: {{screen_lock}} — BYOD: {{byod}} / {{byod_requirements}} — Device inventory: {{device_inventory}}</li></ul>
      <h3>Alerts &amp; Incident Readiness (Section 7)</h3>
      <ul><li>Alerts enabled: {{alerts_enabled}} — Owner: {{alert_owner}} — Checklist: {{incident_checklist}} — First contact: {{incident_contacts}} — Past incidents: {{past_incidents}} — Details: {{incident_details}}</li></ul>
      <h3>Compliance &amp; Policies (Section 8)</h3>
      <ul><li>Legal requirements: {{legal_contract_requirements}} — Customer security asks: {{customer_security_requests}} — DPA: {{dpa_usage}} — Vendor check: {{vendor_security_check}} — Training: {{training_cadence}} — Cyber insurance: {{cyber_insurance}} — Checkups: {{security_checkups}}</li></ul>
      <h3>Additional</h3>
      <ul><li>Timeline: {{timeline}} — Budget: {{budget_range}} — Concerns: {{message}}</li></ul>
    </section>
  </div>
  <script>
  (function() {
    var toggle = document.getElementById('theme-toggle');
    if (toggle) {
      function updateLabel() { toggle.textContent = (document.documentElement.getAttribute('data-theme') === 'light') ? 'Light' : 'Dark'; }
      updateLabel();
      toggle.addEventListener('click', function() {
        var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('flare_theme', next); } catch(e) {}
        updateLabel();
      });
    }
  })();
  </script>
</body>
</html>`;
}

/** Portuguese (PT) report template: same structure as Flare default with PT headings/labels. */
function getDefaultReportTemplateBodyFlarePT() {
  const en = getDefaultReportTemplateBodyFlare();
  return en
    .replace(/<title>Flare Compass – Security Report<\/title>/, "<title>Flare Compass – Relatório de Segurança</title>")
    .replace(/Your risks in order, with clear steps to fix them yourself\./, "Os seus riscos por ordem, com passos claros para os resolver você mesmo.")
    .replace(/<html lang="en">/, "<html lang=\"pt-PT\">")
    .replace(/Security & Operations Risk Assessment Report/g, "Relatório de Avaliação de Riscos de Segurança e Operações")
    .replace(/Generated from assessment data/g, "Gerado a partir do questionário")
    .replace(/>Report Metadata<\/h2>/, ">Metadados do relatório</h2>")
    .replace(/<label>Company<\/label>/, "<label>Empresa</label>")
    .replace(/<label>Prepared for<\/label>/, "<label>Preparado para</label>")
    .replace(/<label>Prepared by<\/label>/, "<label>Preparado por</label>")
    .replace(/<label>Assessment Date<\/label>/, "<label>Data do questionário</label>")
    .replace(/<label>Scope<\/label>/, "<label>Âmbito</label>")
    .replace(/<label>Language\/Locale<\/label>/, "<label>Idioma</label>")
    .replace(/>Executive Summary<\/h2>/, ">Resumo executivo</h2>")
    .replace(/>Environment Profile \(From Assessment\)<\/h2>/, ">Perfil do ambiente (questionário)</h2>")
    .replace(/>Risk Scoring Framework<\/h2>/, ">Framework de pontuação de risco</h2>")
    .replace(/>Key Findings &amp; Gaps \(Evidence-Based\)<\/h2>/, ">Principais conclusões e lacunas</h2>")
    .replace(/>Prioritized Action Plan<\/h2>/, ">Plano de ação prioritizado</h2>")
    .replace(/>Policy, Process, and Controls Upgrades<\/h2>/, ">Melhorias de políticas, processos e controlos</h2>")
    .replace(/>Monitoring, Metrics, and Alerts<\/h2>/, ">Monitorização, métricas e alertas</h2>")
    .replace(/>Tooling &amp; Integration Recommendations<\/h2>/, ">Recomendações de ferramentas e integração</h2>")
    .replace(/>Assumptions, Constraints, and Data Quality<\/h2>/, ">Premissas, restrições e qualidade dos dados</h2>")
    .replace(/>Appendix: Raw Assessment Responses<\/h2>/, ">Anexo: Respostas do questionário</h2>")
    .replace(/>Dark<\/button>/, ">Escuro</button>")
    .replace(/\? 'Light' : 'Dark'/, "? 'Claro' : 'Escuro'");
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
