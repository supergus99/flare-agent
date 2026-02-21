/**
 * Email delivery via SMTP API. Resend (primary) or generic POST for SendGrid/Postmark/Mailgun.
 * Attach PDF link or include report summary in body.
 */

const RESEND_API = 'https://api.resend.com/emails';

/**
 * @param {object} env - { RESEND_API_KEY?, FROM_EMAIL? }
 * @param {{ to: string; subject: string; htmlBody: string; reportUrl?: string; pdfUrl?: string }} params
 * @returns {Promise<{ ok: boolean; error?: string }>}
 */
export async function sendReportEmail(env, params) {
  const { to, subject, htmlBody, reportUrl, pdfUrl } = params;
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'RESEND_API_KEY is not set' };
  }

  const from = env.FROM_EMAIL || env.FLARE_FROM_EMAIL || 'Flare <noreply@getflare.net>';
  let body = htmlBody;
  if (reportUrl || pdfUrl) {
    body += `<p><strong>Report link:</strong> <a href="${reportUrl || pdfUrl}">View report</a></p>`;
  }

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html: body,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: err };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message) };
  }
}
