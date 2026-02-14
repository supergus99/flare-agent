/**
 * Single queue consumer for flare-jobs. Branch on msg.body.type:
 * - welcome_email: send welcome email with assessment link + code
 * - generate_report: load submission, call AI, upload to R2, insert reports row
 */

import { getPaymentById } from '../lib/d1.js';
import { sendWelcomeEmail } from './email.js';
import { handleGenerateReport } from './report-generation.js';

/**
 * @param {MessageBatch} batch - Cloudflare Queue batch
 * @param {object} env - { DB, JOBS, REPORTS, RESEND_API_KEY, FLARE_BASE_URL, OPENAI_API_KEY, ... }
 * @param {ExecutionContext} ctx
 */
export async function handleQueueBatch(batch, env, ctx) {
  for (const msg of batch.messages) {
    try {
      const { type, payment_id, submission_id } = msg.body || {};
      if (type === 'welcome_email' && payment_id) {
        await handleWelcomeEmail(env, payment_id);
      } else if (type === 'generate_report' && (submission_id || payment_id)) {
        await handleGenerateReport(env, submission_id, payment_id);
      }
      msg.ack();
    } catch (err) {
      console.error('Queue message failed:', err);
      msg.retry();
    }
  }
}

async function handleWelcomeEmail(env, paymentId) {
  const payment = await getPaymentById(env.DB, paymentId);
  if (!payment) {
    throw new Error(`Payment not found: ${paymentId}`);
  }
  const baseUrl = (env.FLARE_BASE_URL || '').replace(/\/$/, '');
  const assessmentUrl = `${baseUrl}/assessment?h=${encodeURIComponent(payment.access_hash)}`;
  await sendWelcomeEmail(
    env,
    paymentId,
    payment.customer_email,
    assessmentUrl,
    payment.verification_code
  );
}
