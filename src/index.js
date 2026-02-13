/**
 * Flare – Worker entrypoint
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(
        JSON.stringify({ name: "flare", ok: true }),
        { headers: { "Content-Type": "application/json" } }
      );
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
    return new Response("Not Found", { status: 404 });
  },
};
