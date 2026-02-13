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
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
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
  // Regenerate access_hash with payment id (same as STR)
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
        const hash = await hashAdminPassword(salt, password);
        if (hash !== admin.password_hash) return json({ ok: false, error: "Invalid credentials" }, 401);
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

  let htmlContent = "";
  try {
    const data = typeof submission.assessment_data === "string" ? JSON.parse(submission.assessment_data || "{}") : (submission.assessment_data || {});
    htmlContent = buildStubReportHtml(submission, data);
  } catch (_) {
    htmlContent = buildStubReportHtml(submission, {});
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

function buildStubReportHtml(submission, data) {
  const name = submission.name || submission.email || "Customer";
  const company = submission.company || "—";
  const email = submission.email || "—";
  const message = submission.message || (data.describe_concerns || "");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Security Assessment Report – Flare</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }
    h1 { color: #1a1a1a; }
    .meta { color: #666; font-size: 0.9rem; margin-bottom: 1.5rem; }
    .section { margin-top: 1.5rem; }
    .section h2 { font-size: 1.1rem; color: #333; }
  </style>
</head>
<body>
  <h1>Security Assessment Report</h1>
  <p class="meta">Generated by Flare. This is a placeholder report; connect AI (OpenAI/Workers AI) for full content.</p>
  <div class="section">
    <h2>Contact</h2>
    <p><strong>Name:</strong> ${escapeHtml(name)}</p>
    <p><strong>Company:</strong> ${escapeHtml(company)}</p>
    <p><strong>Email:</strong> ${escapeHtml(email)}</p>
  </div>
  ${message ? `<div class="section"><h2>Notes</h2><p>${escapeHtml(message)}</p></div>` : ""}
  <hr>
  <p style="color:#888;font-size:0.85rem;">Report generated on ${new Date().toISOString().slice(0, 10)}. Phase 2 stub.</p>
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
