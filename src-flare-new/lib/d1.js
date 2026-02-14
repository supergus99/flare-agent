/**
 * D1 helpers for flare-worker. Assumes binding name DB.
 * All functions take env and use env.DB.
 */

/**
 * @param {D1Database} db
 * @param {string} accessHash
 * @returns {Promise<{ id: number, customer_email: string, verification_code: string, expires_at: string, assessment_submitted_at: string | null } | null>}
 */
export async function getPaymentByAccessHash(db, accessHash) {
  const row = await db
    .prepare(
      'SELECT id, customer_email, verification_code, expires_at, assessment_submitted_at FROM payments WHERE access_hash = ?'
    )
    .bind(accessHash)
    .first();
  return row ?? null;
}

/**
 * @param {D1Database} db
 * @param {number} paymentId
 * @returns {Promise<object | null>}
 */
export async function getPaymentById(db, paymentId) {
  const row = await db
    .prepare('SELECT * FROM payments WHERE id = ?')
    .bind(paymentId)
    .first();
  return row ?? null;
}

/**
 * @param {D1Database} db
 * @param {number} submissionId
 * @returns {Promise<object | null>}
 */
export async function getSubmissionById(db, submissionId) {
  const row = await db
    .prepare('SELECT * FROM contact_submissions WHERE id = ?')
    .bind(submissionId)
    .first();
  return row ?? null;
}

/**
 * @param {D1Database} db
 * @param {string} viewHash
 * @returns {Promise<{ id: number, r2_key: string, status: string, view_expires_at: string | null } | null>}
 */
export async function getReportByViewHash(db, viewHash) {
  const row = await db
    .prepare('SELECT id, r2_key, status, view_expires_at FROM reports WHERE view_hash = ?')
    .bind(viewHash)
    .first();
  return row ?? null;
}

/**
 * @param {D1Database} db
 * @param {string} key
 * @returns {Promise<string | null>}
 */
export async function getSetting(db, key) {
  const row = await db
    .prepare('SELECT setting_value FROM automation_settings WHERE setting_key = ?')
    .bind(key)
    .first();
  return row && row.setting_value != null ? row.setting_value : null;
}

/**
 * @param {D1Database} db
 * @param {string} key
 * @param {string} value
 */
export async function setSetting(db, key, value) {
  await db
    .prepare(
      'INSERT INTO automation_settings (setting_key, setting_value, updated_at) VALUES (?, ?, datetime(\'now\')) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = datetime(\'now\')'
    )
    .bind(key, value)
    .run();
}

function nowISO() {
  return new Date().toISOString();
}

/**
 * @param {D1Database} db
 * @param {object} params
 * @returns {Promise<number>} new payment id
 */
export async function insertPayment(db, params) {
  const {
    stripe_session_id,
    customer_email,
    customer_name,
    amount_cents,
    currency,
    payment_status,
    access_hash,
    verification_code,
    expires_at,
  } = params;
  const r = await db
    .prepare(
      `INSERT INTO payments (stripe_session_id, customer_email, customer_name, amount_cents, currency, payment_status, access_hash, verification_code, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .bind(
      stripe_session_id ?? null,
      customer_email,
      customer_name ?? null,
      amount_cents ?? null,
      currency ?? 'eur',
      payment_status ?? 'completed',
      access_hash,
      verification_code,
      expires_at ?? null
    )
    .run();
  return r.meta.last_row_id;
}

/**
 * @param {D1Database} db
 * @param {number} paymentId
 * @param {object} params
 */
export async function updatePayment(db, paymentId, params) {
  const { access_hash, verification_code, expires_at, assessment_submitted_at } = params;
  const updates = [];
  const bindings = [];
  if (access_hash != null) {
    updates.push('access_hash = ?');
    bindings.push(access_hash);
  }
  if (verification_code != null) {
    updates.push('verification_code = ?');
    bindings.push(verification_code);
  }
  if (expires_at != null) {
    updates.push('expires_at = ?');
    bindings.push(expires_at);
  }
  if (assessment_submitted_at !== undefined) {
    updates.push('assessment_submitted_at = ?');
    bindings.push(assessment_submitted_at);
  }
  if (updates.length === 0) return;
  updates.push("updated_at = datetime('now')");
  bindings.push(paymentId);
  await db
    .prepare(`UPDATE payments SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...bindings)
    .run();
}

/**
 * @param {D1Database} db
 * @param {object} params
 * @returns {Promise<number>} new submission id
 */
export async function insertSubmission(db, params) {
  const { payment_id, email, name, assessment_data, status } = params;
  const r = await db
    .prepare(
      `INSERT INTO contact_submissions (payment_id, email, name, assessment_data, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .bind(payment_id, email, name ?? null, assessment_data ?? null, status ?? 'new')
    .run();
  return r.meta.last_row_id;
}

/**
 * @param {D1Database} db
 * @param {object} params
 * @returns {Promise<number>} new report id
 */
export async function insertReport(db, params) {
  const { submission_id, payment_id, status, view_hash, view_expires_at, r2_key } = params;
  const r = await db
    .prepare(
      `INSERT INTO reports (submission_id, payment_id, status, view_hash, view_expires_at, r2_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .bind(
      submission_id,
      payment_id,
      status ?? 'pending_review',
      view_hash,
      view_expires_at ?? null,
      r2_key ?? null
    )
    .run();
  return r.meta.last_row_id;
}

/**
 * @param {D1Database} db
 * @param {number} reportId
 * @param {object} params
 */
export async function updateReportSent(db, reportId, params) {
  const { view_expires_at } = params;
  await db
    .prepare(
      `UPDATE reports SET status = 'sent', sent_at = datetime('now'), view_expires_at = ?, updated_at = datetime('now') WHERE id = ?`
    )
    .bind(view_expires_at ?? null, reportId)
    .run();
}

/**
 * @param {D1Database} db
 * @param {object} params - { payment_id, email_type, recipient_email, subject, status, sent_at? }
 */
export async function insertEmailLog(db, params) {
  const { payment_id, email_type, recipient_email, subject, status, sent_at } = params;
  const now = status === 'sent' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null;
  await db
    .prepare(
      `INSERT INTO email_logs (payment_id, email_type, recipient_email, subject, status, sent_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .bind(
      payment_id ?? null,
      email_type,
      recipient_email,
      subject ?? '',
      status ?? 'pending',
      sent_at ?? now
    )
    .run();
}

/**
 * @param {D1Database} db
 * @param {string} stripeSessionId
 * @returns {Promise<object | null>}
 */
export async function getPaymentByStripeSessionId(db, stripeSessionId) {
  const row = await db
    .prepare('SELECT * FROM payments WHERE stripe_session_id = ?')
    .bind(stripeSessionId)
    .first();
  return row ?? null;
}
