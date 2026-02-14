/**
 * Send email via Resend (or swap for SendGrid/etc.) and log to email_logs.
 * Requires env.RESEND_API_KEY and env.DB.
 */

import { insertEmailLog } from '../lib/d1.js';

const RESEND_API = 'https://api.resend.com/emails';

/**
 * @param {object} env - { DB, RESEND_API_KEY }
 * @param {object} opts - { to, subject, html, text }
 * @returns {Promise<{ ok: boolean, id?: string, error?: string }>}
 */
export async function sendEmail(env, opts) {
  const { to, subject, html, text } = opts;
  const key = env.RESEND_API_KEY;
  if (!key) {
    return { ok: false, error: 'RESEND_API_KEY not set' };
  }
  const body = {
    from: env.FLARE_FROM_EMAIL || 'Flare <noreply@yourdomain.com>',
    to: [to],
    subject,
    html: html || text || '',
  };
  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data.message || res.statusText };
  }
  return { ok: true, id: data.id };
}

/**
 * Send welcome email and log. Used by queue consumer.
 * @param {object} env - { DB, RESEND_API_KEY, FLARE_BASE_URL, FLARE_FROM_EMAIL }
 * @param {number} paymentId
 * @param {string} to
 * @param {string} assessmentUrl
 * @param {string} verificationCode
 */
export async function sendWelcomeEmail(env, paymentId, to, assessmentUrl, verificationCode) {
  const subject = 'Your assessment link and security code';
  const html = `
    <p>Thank you for your purchase.</p>
    <p>Use the link below to access your assessment. You will need this security code: <strong>${verificationCode}</strong></p>
    <p><a href="${assessmentUrl}">${assessmentUrl}</a></p>
    <p>This link expires in 30 days.</p>
  `;
  const result = await sendEmail(env, { to, subject, html });
  await insertEmailLog(env.DB, {
    payment_id: paymentId,
    email_type: 'welcome',
    recipient_email: to,
    subject,
    status: result.ok ? 'sent' : 'failed',
  });
  return result;
}

/**
 * Send report delivery email and log. Used by approve & send.
 * @param {object} env
 * @param {number} paymentId
 * @param {string} to
 * @param {string} reportUrl
 */
export async function sendReportEmail(env, paymentId, to, reportUrl) {
  const subject = 'Your report is ready';
  const html = `
    <p>Your report has been approved and is ready to view.</p>
    <p><a href="${reportUrl}">View your report</a></p>
    <p>This link will expire in 30 days.</p>
  `;
  const result = await sendEmail(env, { to, subject, html });
  await insertEmailLog(env.DB, {
    payment_id: paymentId,
    email_type: 'report_delivery',
    recipient_email: to,
    subject,
    status: result.ok ? 'sent' : 'failed',
  });
  return result;
}
