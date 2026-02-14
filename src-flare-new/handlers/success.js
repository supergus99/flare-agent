/**
 * GET /api/success?session_id=... – after Stripe checkout, ensure payment in D1 and redirect to success page with hash.
 * If payment already exists (from webhook), use it; otherwise create from session.
 */

import { retrieveCheckoutSession } from '../lib/stripe.js';
import { getPaymentByStripeSessionId, insertPayment } from '../lib/d1.js';
import { generateAccessHash, generateVerificationCode } from '../lib/crypto.js';

export async function handleSuccess(url, env) {
  const sessionId = url.searchParams.get('session_id');
  if (!sessionId) {
    return jsonResponse(400, { error: 'session_id required' });
  }
  const stripeKey = env.STRIPE_SECRET_KEY;
  const db = env.DB;
  if (!stripeKey || !db) {
    return jsonResponse(503, { error: 'Worker not configured' });
  }
  let session;
  try {
    session = await retrieveCheckoutSession(stripeKey, sessionId);
  } catch (e) {
    return jsonResponse(500, { error: e.message || 'Failed to load session' });
  }
  const customerEmail =
    session.customer_email ||
    session.customer_details?.email ||
    session.payment_intent?.receipt_email ||
    '';
  const customerName =
    session.customer_details?.name ||
    session.metadata?.customer_name ||
    '';
  const amount = session.amount_total ?? 0;
  const currency = (session.currency || 'eur').toLowerCase();
  let payment = await getPaymentByStripeSessionId(db, sessionId);
  if (!payment) {
    const access_hash = await generateAccessHash();
    const verification_code = await generateVerificationCode();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const paymentId = await insertPayment(db, {
      stripe_session_id: sessionId,
      customer_email: customerEmail,
      customer_name: customerName || null,
      amount_cents: amount,
      currency,
      payment_status: 'completed',
      access_hash,
      verification_code,
      expires_at: expiresAt,
    });
    payment = await db.prepare('SELECT * FROM payments WHERE id = ?').bind(paymentId).first();
  }
  if (!payment) {
    return jsonResponse(500, { error: 'Payment not found' });
  }
  const base = (env.SUCCESS_BASE_URL || env.WORKER_PUBLIC_URL || '').replace(/\/$/, '');
  const successPath = 'success.html';
  const redirectUrl = `${base}/${successPath}?hash=${encodeURIComponent(payment.access_hash)}`;
  return Response.redirect(redirectUrl, 302);
}

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
