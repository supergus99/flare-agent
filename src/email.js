/**
 * Send email via Resend API (Phase 3).
 * @param {string} apiKey - RESEND_API_KEY
 * @param {{ from: string, to: string | string[], subject: string, html: string }} opts
 * @returns {Promise<{ id?: string, error?: string }>}
 */
export async function sendResend(apiKey, opts) {
  if (!apiKey) return { error: "Resend API key not set" };
  const to = Array.isArray(opts.to) ? opts.to : [opts.to];
  const body = {
    from: opts.from,
    to,
    subject: opts.subject,
    html: opts.html,
  };
  if (opts.reply_to) body.reply_to = opts.reply_to;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.error || (Array.isArray(data.errors) && data.errors[0]?.message) || (typeof data.msg === "string" && data.msg) || `Resend ${res.status}`;
    return { error: typeof msg === "string" ? msg : `Resend ${res.status}` };
  }
  return { id: data.id };
}
