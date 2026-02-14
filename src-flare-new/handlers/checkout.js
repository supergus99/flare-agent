/**
 * POST /api/checkout – create Stripe Checkout Session, return { url, session_id }.
 * Body: { service_type?, currency?, customer_email?, customer_name?, locale? }
 */

import { createCheckoutSession, ALLOWED_SERVICES } from '../lib/stripe.js';

export async function handleCheckout(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }
  const stripeKey = env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return jsonResponse(503, { error: 'Stripe not configured' });
  }
  let body;
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON' });
  }
  const serviceType = String(body.service_type ?? 'core').trim().toLowerCase();
  if (!ALLOWED_SERVICES.includes(serviceType)) {
    return jsonResponse(400, { error: 'Invalid service_type. Use core, protect, or assure.' });
  }
  const currency = ['eur', 'usd'].includes(String(body.currency ?? '').toLowerCase())
    ? String(body.currency).toLowerCase()
    : 'eur';
  const workerBase = (env.WORKER_PUBLIC_URL || '').replace(/\/$/, '');
  const pagesBase = (env.SUCCESS_BASE_URL || '').replace(/\/$/, '');
  if (!workerBase) {
    return jsonResponse(503, { error: 'WORKER_PUBLIC_URL not set' });
  }
  const successUrl = `${workerBase}/api/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${pagesBase || workerBase}/checkout.html?canceled=1`;
  try {
    const session = await createCheckoutSession(stripeKey, {
      success_url: successUrl,
      cancel_url: cancelUrl,
      service_type: serviceType,
      currency,
      customer_email: body.customer_email?.trim() || undefined,
      customer_name: body.customer_name?.trim() || undefined,
    });
    return jsonResponse(200, { ok: true, url: session.url, session_id: session.id });
  } catch (e) {
    return jsonResponse(500, { error: e.message || 'Checkout failed' });
  }
}

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
