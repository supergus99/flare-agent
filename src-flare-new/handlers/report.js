/**
 * GET /report?h=view_hash (view), GET /report?h=...&download=1 (download),
 * POST /api/reports/approve (admin approve & send).
 */

import { getReportByViewHash, updateReportSent, getPaymentById } from '../lib/d1.js';
import { sendReportEmail } from './email.js';

const SENT_VIEW_EXTEND_DAYS = 30;

/**
 * GET /report?h=view_hash
 * Optional: &download=1 for attachment.
 * @param {URL} url
 * @param {object} env - { DB, REPORTS, FLARE_BASE_URL }
 * @returns {Promise<Response>}
 */
export async function handleReportView(url, env) {
  const viewHash = url.searchParams.get('h') || url.searchParams.get('hash');
  if (!viewHash) {
    return new Response('Missing report hash', { status: 400 });
  }
  let report = await getReportByViewHash(env.DB, viewHash);
  if (!report && env.DB) {
    const payment = await env.DB.prepare('SELECT id FROM payments WHERE access_hash = ? LIMIT 1').bind(viewHash).first();
    if (payment) {
      const r = await env.DB.prepare('SELECT id, r2_key, status, view_expires_at FROM reports WHERE payment_id = ? ORDER BY id DESC LIMIT 1').bind(payment.id).first();
      if (r) report = r;
    }
  }
  if (!report) {
    return new Response('Report not found', { status: 404 });
  }
  if (report.view_expires_at && new Date(report.view_expires_at) < new Date()) {
    return new Response('This report link has expired.', { status: 410 });
  }
  if (!env.REPORTS || !report.r2_key) {
    return new Response('Report file not found', { status: 404 });
  }
  const object = await env.REPORTS.get(report.r2_key);
  if (!object) {
    return new Response('Report file not found', { status: 404 });
  }
  const download = url.searchParams.get('download') === '1' || url.searchParams.get('download') === 'true';
  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'text/html; charset=utf-8');
  if (download) {
    headers.set(
      'Content-Disposition',
      `attachment; filename="report-${viewHash}.html"`
    );
  }
  return new Response(object.body, { status: 200, headers });
}

/**
 * POST /api/reports/approve or POST /api/admin/reports/:id/approve
 * Body (for /api/reports/approve): { report_id, approve_confirmation: 'APPROVE' }
 * Sends report email, updates report status and view_expires_at.
 * @param {Request} request
 * @param {object} env - { DB, REPORTS, FLARE_BASE_URL, RESEND_API_KEY }
 * @param {{ reportId?: number }} opts - if reportId provided (from URL), body.report_id optional
 * @returns {Promise<Response>}
 */
export async function handleReportApprove(request, env, opts = {}) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  let body;
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON' });
  }
  const reportId = opts.reportId != null ? parseInt(opts.reportId, 10) : (body?.report_id != null ? parseInt(body.report_id, 10) : null);
  if (!opts.reportId && body?.approve_confirmation !== 'APPROVE') {
    return jsonResponse(400, { error: 'approve_confirmation must be APPROVE' });
  }
  if (reportId == null || !Number.isInteger(reportId)) {
    return jsonResponse(400, { error: 'report_id required' });
  }
  const row = await env.DB.prepare(
    'SELECT id, view_hash, payment_id, status FROM reports WHERE id = ?'
  )
    .bind(reportId)
    .first();
  if (!row) {
    return jsonResponse(404, { error: 'Report not found' });
  }
  const payment = await getPaymentById(env.DB, row.payment_id);
  if (!payment) {
    return jsonResponse(500, { error: 'Payment not found' });
  }
  const baseUrl = (env.FLARE_BASE_URL || '').replace(/\/$/, '');
  const reportUrl = `${baseUrl}/report?h=${encodeURIComponent(row.view_hash)}`;
  await sendReportEmail(env, row.payment_id, payment.customer_email, reportUrl);
  const viewExpiresAt = new Date(
    Date.now() + SENT_VIEW_EXTEND_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  await updateReportSent(env.DB, row.id, { view_expires_at: viewExpiresAt });
  return jsonResponse(200, {
    success: true,
    report_id: row.id,
    view_hash: row.view_hash,
    sent_to: payment.customer_email,
  });
}

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
