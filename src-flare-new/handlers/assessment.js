/**
 * Assessment gate (GET /assessment?h=...), code gate, and POST /api/assessments.
 */

import { getPaymentByAccessHash, insertSubmission, updatePayment } from '../lib/d1.js';

/**
 * GET /assessment?h=access_hash
 * If valid: redirect to code gate or show form (or return HTML). If invalid: 400/403 with message.
 * @param {URL} url
 * @param {object} env - { DB }
 * @returns {Promise<Response>}
 */
export async function handleAssessmentGate(url, env) {
  const accessHash = url.searchParams.get('h');
  if (!accessHash) {
    return new Response('Missing access hash', { status: 400 });
  }
  const payment = await getPaymentByAccessHash(env.DB, accessHash);
  if (!payment) {
    return new Response('Payment not found or link invalid.', { status: 404 });
  }
  if (payment.expires_at && new Date(payment.expires_at) < new Date()) {
    return new Response('This link has expired.', { status: 410 });
  }
  if (payment.assessment_submitted_at) {
    return new Response('Assessment already submitted for this purchase.', {
      status: 410,
    });
  }
  const code = url.searchParams.get('code');
  if (!code) {
    return htmlResponse(200, gatePage(accessHash, null));
  }
  if (code !== payment.verification_code) {
    return htmlResponse(200, gatePage(accessHash, 'Invalid security code.'));
  }
  return htmlResponse(200, formPage(accessHash));
}

function gatePage(accessHash, error) {
  return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Access assessment</title></head>
<body>
  <h1>Enter your security code</h1>
  ${error ? `<p style="color:red">${error}</p>` : ''}
  <form method="get" action="/assessment">
    <input type="hidden" name="h" value="${escapeAttr(accessHash)}">
    <label>Security code: <input type="text" name="code" required autocomplete="one-time-code"></label>
    <button type="submit">Continue</button>
  </form>
</body></html>`;
}

function formPage(accessHash) {
  return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Assessment</title></head>
<body>
  <h1>Assessment form</h1>
  <form id="assessment-form" method="post" action="/api/assessments">
    <input type="hidden" name="h" value="${escapeAttr(accessHash)}">
    <input type="hidden" name="honeypot" value="" tabindex="-1" autocomplete="off">
    <label>Email: <input type="email" name="email" required></label><br>
    <label>Name: <input type="text" name="name"></label><br>
    <label>Assessment (paste or type): <textarea name="assessment_data" rows="10"></textarea></label><br>
    <button type="submit">Submit</button>
  </form>
  <script>
    document.getElementById('assessment-form').addEventListener('submit', function(e) {
      e.preventDefault();
      var form = e.target;
      var fd = new FormData(form);
      fetch(form.action, { method: 'POST', body: fd })
        .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, d }; }); })
        .then(function({ ok, d }) {
          if (ok) { document.body.innerHTML = '<p>Thank you. Your assessment has been submitted.</p>'; }
          else { alert(d.error || 'Submission failed'); }
        });
    });
  </script>
</body></html>`;
}

/**
 * POST /api/assessments
 * Body: FormData or JSON with h (access_hash), email, name, assessment_data, honeypot, [captcha token if used].
 * Validate honeypot, then access_hash in D1, insert submission, set assessment_submitted_at, enqueue generate_report.
 * @param {Request} request
 * @param {object} env - { DB, JOBS }
 * @returns {Promise<Response>}
 */
export async function handleAssessmentsPost(request, env) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  let h, email, name, assessment_data, honeypot;
  const contentType = request.headers.get('Content-Type') || '';
  if (contentType.includes('application/json')) {
    const body = await request.json();
    h = body.h ?? body.access_hash ?? body.hash;
    email = body.email;
    name = body.name ?? body.contact_name;
    assessment_data = body.assessment_data;
    honeypot = body.honeypot;
  } else {
    const fd = await request.formData();
    h = fd.get('h') || fd.get('access_hash') || fd.get('hash');
    email = fd.get('email');
    name = fd.get('name');
    assessment_data = fd.get('assessment_data');
    honeypot = fd.get('honeypot');
  }
  if (honeypot) {
    return jsonResponse(200, { success: true });
  }
  if (!email) {
    return jsonResponse(400, { error: 'Email is required' });
  }
  let payment = null;
  if (h) {
    payment = await getPaymentByAccessHash(env.DB, h.trim());
  }
  if (!payment && h) {
    return jsonResponse(404, { error: 'Invalid or expired link' });
  }
  if (!payment) {
    return jsonResponse(400, { error: 'Access hash (or link from your purchase) is required to submit' });
  }
  if (payment.expires_at && new Date(payment.expires_at) < new Date()) {
    return jsonResponse(410, { error: 'Link expired' });
  }
  if (payment.assessment_submitted_at) {
    return jsonResponse(410, { error: 'Assessment already submitted' });
  }
  const assessmentDataStr =
    typeof assessment_data === 'string'
      ? assessment_data
      : JSON.stringify(assessment_data || {});
  const submissionId = await insertSubmission(env.DB, {
    payment_id: payment.id,
    email: email.trim(),
    name: name ? String(name).trim() : null,
    assessment_data: assessmentDataStr,
    status: 'new',
  });
  await updatePayment(env.DB, payment.id, {
    assessment_submitted_at: new Date().toISOString(),
  });
  if (env.JOBS) {
    await env.JOBS.send({
      type: 'generate_report',
      submission_id: submissionId,
      payment_id: payment.id,
    });
  }
  return jsonResponse(200, { success: true, submission_id: submissionId });
}

const DEFAULT_FORM_CONFIG = {
  title: 'Security assessment',
  intro: 'Complete this form so we can generate your report. If you paid via Stripe, use the link from your confirmation email (it includes your secure access code).',
  hashWarning: 'No access code in the URL. If you have a link from your payment confirmation, use that.',
  submitLabel: 'Submit assessment',
  fields: [
    { name: 'company_name', label: 'Company name *', type: 'text', required: true, placeholder: 'Your company', order: 1 },
    { name: 'contact_name', label: 'Your name *', type: 'text', required: true, placeholder: 'Full name', order: 2 },
    { name: 'email', label: 'Email *', type: 'email', required: true, placeholder: 'you@example.com', order: 3 },
    { name: 'role', label: 'Role (optional)', type: 'text', required: false, placeholder: 'e.g. Operations Manager', order: 4 },
    { name: 'message', label: 'Additional notes (optional)', type: 'textarea', required: false, placeholder: 'Any specific concerns or context...', order: 5 },
  ],
};

/**
 * GET /api/assessment-template – return form config for the assessment page (no auth).
 * @param {object} env - { DB } (optional; if DB has assessment_template table, can return custom html/config)
 * @returns {Promise<Response>}
 */
export async function handleAssessmentTemplateGet(env) {
  try {
    if (env.DB) {
      const row = await env.DB.prepare('SELECT form_config, body FROM assessment_template WHERE id = 1 LIMIT 1').first().catch(() => null);
      if (row?.body != null && String(row.body).trim() !== '') {
        return jsonResponse(200, { ok: true, html: row.body });
      }
      if (row?.form_config) {
        const data = typeof row.form_config === 'string' ? JSON.parse(row.form_config) : row.form_config;
        return jsonResponse(200, { ok: true, data });
      }
    }
  } catch (_) {}
  return jsonResponse(200, { ok: true, data: DEFAULT_FORM_CONFIG });
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function htmlResponse(status, html) {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
