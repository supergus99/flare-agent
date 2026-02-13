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

    return new Response("Not Found", { status: 404 });
  },

  async queue(batch, env, ctx) {
    for (const msg of batch.messages) {
      try {
        const body = msg.body;
        if (body?.type === "test") console.log("Queue test message:", body);
        msg.ack();
      } catch (e) {
        msg.retry();
      }
    }
  },
};
