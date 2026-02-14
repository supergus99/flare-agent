/**
 * Stripe webhook: checkout.session.completed → insert/update payment in D1, enqueue welcome_email.
 * Verify signature with HMAC SHA256 (no Stripe SDK required).
 */

import { generateAccessHash, generateVerificationCode } from '../lib/crypto.js';
import {
  getPaymentByStripeSessionId,
  insertPayment,
  updatePayment,
} from '../lib/d1.js';

/**
 * @param {string} payload - raw request body
 * @param {string} signature - Stripe-Signature header
 * @param {string} secret - STRIPE_WEBHOOK_SECRET
 * @returns {boolean}
 */
async function verifyStripeSignature(payload, signature, secret) {
  const parts = signature.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    acc[k] = v;
    return acc;
  }, {});
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) return false;
  const signedPayload = `${t}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signedPayload)
  );
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return v1 === expected;
}

/**
 * @param {Request} request
 * @param {object} env - { DB, JOBS, STRIPE_WEBHOOK_SECRET, FLARE_BASE_URL }
 * @returns {Promise<Response>}
 */
export async function handleStripeWebhook(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return new Response('Webhook secret not configured', { status: 500 });
  }
  const rawBody = await request.text();
  const signature = request.headers.get('Stripe-Signature') || '';
  const valid = await verifyStripeSignature(rawBody, signature, secret);
  if (!valid) {
    return new Response('Invalid signature', { status: 400 });
  }
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  if (event.type !== 'checkout.session.completed') {
    return new Response('OK', { status: 200 });
  }
  const session = event.data?.object;
  if (!session?.id) {
    return new Response('Invalid payload', { status: 400 });
  }
  const db = env.DB;
  const existing = await getPaymentByStripeSessionId(db, session.id);
  const customerEmail =
    session.customer_email ||
    session.customer_details?.email ||
    '';
  const customerName =
    session.customer_details?.name ||
    '';
  const amount = session.amount_total ?? 0;
  const currency = (session.currency || 'eur').toLowerCase();
  const baseUrl = (env.FLARE_BASE_URL || '').replace(/\/$/, '');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  let paymentId;
  if (existing) {
    paymentId = existing.id;
    const access_hash = await generateAccessHash();
    const verification_code = await generateVerificationCode();
    await updatePayment(db, paymentId, {
      access_hash,
      verification_code,
      expires_at: expiresAt,
    });
  } else {
    const access_hash = await generateAccessHash();
    const verification_code = await generateVerificationCode();
    paymentId = await insertPayment(db, {
      stripe_session_id: session.id,
      customer_email: customerEmail,
      customer_name: customerName || null,
      amount_cents: amount,
      currency,
      payment_status: 'completed',
      access_hash,
      verification_code,
      expires_at: expiresAt,
    });
  }
  if (env.JOBS) {
    await env.JOBS.send({
      type: 'welcome_email',
      payment_id: paymentId,
    });
  }
  return new Response('OK', { status: 200 });
}
