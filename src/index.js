/**
 * Flare – minimal Worker entrypoint
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
    return new Response("Not Found", { status: 404 });
  },
};
