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
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.message || data.error || `Resend ${res.status}` };
  return { id: data.id };
}
