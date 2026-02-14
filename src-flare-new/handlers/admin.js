/**
 * Admin API: list payments, submissions, reports, settings.
 * Protected by Bearer token === env.ADMIN_SECRET (if set).
 */

import { setSetting } from '../lib/d1.js';

/**
 * @param {Request} request
 * @param {object} env - { ADMIN_SECRET }
 * @returns {boolean} true if authorized (no secret set, or valid Bearer token)
 */
export function requireAdmin(request, env) {
  if (!env.ADMIN_SECRET) return true;
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  return token === env.ADMIN_SECRET;
}

/**
 * GET /api/admin/submissions
 * @param {object} env - { DB }
 * @returns {Promise<Response>}
 */
export async function handleAdminSubmissions(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, payment_id, email, name, status, created_at
     FROM contact_submissions
     ORDER BY id DESC
     LIMIT 100`
  ).all();
  return jsonResponse(200, { submissions: results });
}

/**
 * GET /api/admin/reports
 * @param {object} env - { DB }
 * @returns {Promise<Response>}
 */
export async function handleAdminReports(env) {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.submission_id, r.payment_id, r.status, r.view_hash, r.view_expires_at, r.sent_at, r.created_at
     FROM reports r
     ORDER BY r.id DESC
     LIMIT 100`
  ).all();
  return jsonResponse(200, { reports: results });
}

/**
 * GET /api/admin/payments
 * @param {object} env - { DB }
 * @returns {Promise<Response>}
 */
export async function handleAdminPayments(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, stripe_session_id, customer_email, customer_name, amount_cents, currency, payment_status, access_hash IS NOT NULL AS has_link, expires_at, assessment_submitted_at, created_at
     FROM payments
     ORDER BY id DESC
     LIMIT 100`
  ).all();
  return jsonResponse(200, { payments: results });
}

/**
 * GET /api/admin/settings
 * @param {object} env - { DB }
 * @returns {Promise<Response>}
 */
export async function handleAdminSettingsGet(env) {
  const { results } = await env.DB.prepare(
    'SELECT setting_key, setting_value, updated_at FROM automation_settings'
  ).all();
  const settings = {};
  for (const row of results) {
    settings[row.setting_key] = row.setting_value;
  }
  return jsonResponse(200, settings);
}

/**
 * POST /api/admin/settings
 * Body: { key, value } or { settings: { key: value } }
 * @param {Request} request
 * @param {object} env - { DB }
 * @returns {Promise<Response>}
 */
export async function handleAdminSettingsPost(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON' });
  }
  if (body.key != null && body.value != null) {
    await setSetting(env.DB, body.key, String(body.value));
    return jsonResponse(200, { ok: true });
  }
  if (body.settings && typeof body.settings === 'object') {
    for (const [k, v] of Object.entries(body.settings)) {
      await setSetting(env.DB, k, String(v));
    }
    return jsonResponse(200, { ok: true });
  }
  return jsonResponse(400, { error: 'key/value or settings object required' });
}

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
