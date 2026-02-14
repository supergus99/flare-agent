/**
 * Generate report: load submission from D1, call AI, build HTML, upload to R2, insert reports row.
 * Used by queue consumer when type === 'generate_report'.
 */

import { generateViewHash } from '../lib/crypto.js';
import {
  getSubmissionById,
  getPaymentById,
  getSetting,
  insertReport,
} from '../lib/d1.js';

const R2_PREFIX = 'reports/';
const VIEW_EXPIRY_DAYS = 30;

/**
 * @param {object} env - { DB, REPORTS, OPENAI_API_KEY }
 * @param {number} [submissionId]
 * @param {number} [paymentId]
 */
export async function handleGenerateReport(env, submissionId, paymentId) {
  const db = env.DB;
  let submission = submissionId
    ? await getSubmissionById(db, submissionId)
    : null;
  if (!submission && paymentId) {
    const byPayment = await db
      .prepare(
        'SELECT * FROM contact_submissions WHERE payment_id = ? ORDER BY id DESC LIMIT 1'
      )
      .bind(paymentId)
      .first();
    submission = byPayment ?? null;
  }
  if (!submission) {
    throw new Error('Submission not found');
  }
  const payment = await getPaymentById(db, submission.payment_id);
  const systemIntro =
    (await getSetting(db, 'ai_instruction_system_intro')) ||
    'You are a security assessment analyst.';
  const riskFramework =
    (await getSetting(db, 'ai_instruction_risk_framework')) ||
    'Use a simple risk matrix: likelihood and impact.';
  const assessmentData =
    typeof submission.assessment_data === 'string'
      ? submission.assessment_data
      : JSON.stringify(submission.assessment_data || {});
  const prompt = `Based on this assessment submission, produce a short security assessment report in HTML (no head/body, just a fragment with sections and paragraphs). Use the risk framework: ${riskFramework}\n\nSubmission data:\n${assessmentData}`;
  const html = await callOpenAI(env, systemIntro, prompt);
  const viewHash = await generateViewHash();
  const r2Key = `${R2_PREFIX}${viewHash}.html`;
  await env.REPORTS.put(r2Key, html, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
  });
  const viewExpiresAt = new Date(
    Date.now() + VIEW_EXPIRY_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  await insertReport(db, {
    submission_id: submission.id,
    payment_id: submission.payment_id,
    status: 'pending_review',
    view_hash: viewHash,
    view_expires_at: viewExpiresAt,
    r2_key: r2Key,
  });
}

/**
 * @param {object} env
 * @param {string} systemIntro
 * @param {string} userPrompt
 * @returns {Promise<string>} HTML fragment
 */
async function callOpenAI(env, systemIntro, userPrompt) {
  const key = env.OPENAI_API_KEY;
  if (!key) {
    return `<html><body><p>Report generation is not configured (missing OPENAI_API_KEY).</p><pre>${escapeHtml(userPrompt.slice(0, 500))}</pre></body></html>`;
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemIntro },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 2000,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    return `<html><body><p>AI request failed: ${escapeHtml(err)}</p></body></html>`;
  }
  const data = await res.json();
  const content =
    data.choices?.[0]?.message?.content?.trim() || '<p>No content.</p>';
  if (!content.startsWith('<')) {
    return `<html><body><p>${escapeHtml(content)}</p></body></html>`;
  }
  return content;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
