/**
 * Stripe API helpers: create checkout session, retrieve session.
 * No Stripe SDK dependency; uses fetch + form encoding.
 */

const TIERS = {
  core: { price_cents: 24900, price_usd_cents: 24900 },
  protect: { price_cents: 8900, price_usd_cents: 8900 },
  assure: { price_cents: 99900, price_usd_cents: 99900 },
};

export const ALLOWED_SERVICES = ['core', 'protect', 'assure'];

function getAmountCents(serviceType, currency = 'eur') {
  const t = TIERS[serviceType] || TIERS.core;
  const c = (currency || 'eur').toLowerCase();
  return c === 'usd' ? t.price_usd_cents : t.price_cents;
}

/**
 * Create Stripe Checkout Session.
 * @param {string} stripeSecretKey
 * @param {{ success_url: string, cancel_url: string, service_type: string, currency: string, customer_email?: string, customer_name?: string }} opts
 * @returns {Promise<{ url: string, id: string }>}
 */
export async function createCheckoutSession(stripeSecretKey, opts) {
  const {
    success_url,
    cancel_url,
    service_type,
    currency = 'eur',
    customer_email,
    customer_name,
  } = opts;
  const amount = getAmountCents(service_type, currency);
  const productName = service_type === 'core' ? 'Risk Visibility Report' : service_type === 'protect' ? 'Risk Analysis & Action Plan' : 'Guided Risk Review';
  const body = {
    payment_method_types: ['card'],
    mode: 'payment',
    success_url,
    cancel_url,
    'line_items[0][price_data][currency]': currency.toLowerCase(),
    'line_items[0][price_data][product_data][name]': productName,
    'line_items[0][price_data][unit_amount]': amount,
    'line_items[0][quantity]': 1,
    'metadata[service_type]': service_type,
    'metadata[customer_email]': customer_email || '',
    'metadata[customer_name]': customer_name || '',
  };
  if (customer_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email)) {
    body.customer_email = customer_email;
  }
  const formBody = new URLSearchParams(body).toString();
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formBody,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Stripe API: ${res.status} ${err}`);
  }
  const data = await res.json();
  return { url: data.url, id: data.id };
}

/**
 * Retrieve Checkout Session (with optional expand).
 * @param {string} stripeSecretKey
 * @param {string} sessionId
 * @returns {Promise<object>}
 */
export async function retrieveCheckoutSession(stripeSecretKey, sessionId) {
  const res = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${sessionId}?expand[]=payment_intent`,
    { headers: { Authorization: `Bearer ${stripeSecretKey}` } }
  );
  if (!res.ok) throw new Error(`Stripe session: ${res.status}`);
  return res.json();
}
