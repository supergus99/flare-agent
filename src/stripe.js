/**
 * Stripe helpers for Flare Worker (Phase 1).
 * Tier config: core, protect, assure with EUR/USD cents.
 */

export const TIER_NAMES = {
  core: "Risk Visibility Report",
  protect: "Risk Analysis & Action Plan",
  assure: "Guided Risk Review",
};

const TIERS = {
  core: { price_cents: 24900, price_usd_cents: 24900 },
  protect: { price_cents: 8900, price_usd_cents: 8900 }, /* launch campaign 89€ / $89 */
  assure: { price_cents: 99900, price_usd_cents: 99900 },
};

export const ALLOWED_SERVICES = ["core", "protect", "assure"];

export function getAmountCents(serviceType, currency = "eur") {
  const t = TIERS[serviceType];
  if (!t) return 0;
  const c = (currency || "eur").toLowerCase();
  return c === "usd" ? t.price_usd_cents : t.price_cents;
}

export function getServiceName(serviceType, short = false) {
  return TIER_NAMES[serviceType] || "Security Assessment";
}

/**
 * Create Stripe Checkout Session. Stripe API expects application/x-www-form-urlencoded.
 * Optional branding_settings override the account logo/name so Flare can show its brand
 * instead of the parent Stripe account (e.g. STR).
 * @param {string} stripeSecretKey
 * @param {{ successUrl: string, cancelUrl: string, serviceType: string, currency: string, customerEmail?: string, customerName?: string, customerCompany?: string, leadId?: number, locale?: string, brandingDisplayName?: string, brandingLogoUrl?: string }} opts
 * @returns {Promise<{ url: string, id: string }>}
 */
export async function createCheckoutSession(stripeSecretKey, opts) {
  const {
    successUrl,
    cancelUrl,
    serviceType,
    currency,
    customerEmail,
    customerName,
    customerCompany,
    leadId,
    locale,
    brandingDisplayName,
    brandingLogoUrl,
  } = opts;
  const amount = getAmountCents(serviceType, currency);
  const productName = getServiceName(serviceType);
  const body = {
    "payment_method_types[0]": "card",
    mode: "payment",
    success_url: successUrl,
    cancel_url: cancelUrl,
    "line_items[0][price_data][currency]": currency.toLowerCase(),
    "line_items[0][price_data][product_data][name]": productName,
    "line_items[0][price_data][unit_amount]": amount,
    "line_items[0][quantity]": 1,
    "metadata[service_type]": serviceType,
    "metadata[customer_name]": customerName || "",
    "metadata[customer_email]": customerEmail || "",
    "metadata[customer_company]": customerCompany || "",
    "metadata[flare_locale]": locale || "",
    "payment_intent_data[metadata][service_type]": serviceType,
    "payment_intent_data[metadata][customer_name]": customerName || "",
    "payment_intent_data[metadata][customer_email]": customerEmail || "",
    "payment_intent_data[metadata][customer_company]": customerCompany || "",
  };
  if (leadId != null) {
    body.client_reference_id = `lead_${leadId}`;
    body["metadata[lead_id]"] = String(leadId);
  }
  if (customerEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    body.customer_email = customerEmail;
  }

  // Override Checkout branding so Flare shows instead of parent account (e.g. STR)
  if (brandingDisplayName && String(brandingDisplayName).trim()) {
    body["branding_settings[display_name]"] = String(brandingDisplayName).trim().slice(0, 200);
  }
  if (brandingLogoUrl && /^https:\/\//.test(String(brandingLogoUrl).trim())) {
    body["branding_settings[logo][type]"] = "url";
    body["branding_settings[logo][url]"] = String(brandingLogoUrl).trim();
  }

  const formBody = new URLSearchParams(body).toString();

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
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
 * Verify Stripe webhook signature (HMAC SHA256).
 * @param {string} payload - Raw request body
 * @param {string} sigHeader - Stripe-Signature header
 * @param {string} secret - Webhook signing secret (whsec_...)
 * @returns {{ timestamp: string, payload: string }}
 */
export function verifyWebhookSignature(payload, sigHeader, secret) {
  if (!payload || !sigHeader || !secret) {
    throw new Error("Missing payload, signature, or secret");
  }
  const parts = sigHeader.split(",").reduce((acc, p) => {
    const [k, v] = p.trim().split("=");
    if (k && v) acc[k] = v;
    return acc;
  }, {});
  const timestamp = parts.t;
  const sig = parts.v1;
  if (!timestamp || !sig) throw new Error("Invalid Stripe-Signature format");
  const signed = `${timestamp}.${payload}`;
  // Web Crypto: we need to HMAC in Worker. crypto.subtle.sign with HMAC.
  // Stripe uses hex-encoded signature; we need to compare.
  // In Workers we can use the Web Crypto API. HMAC-SHA256 and compare as hex.
  // crypto.subtle is async. We'll do the verification in an async function.
  return { timestamp, payload: signed, expectedSignature: sig, secret };
}

/**
 * Compute HMAC SHA256 and return hex string (for Stripe webhook verification).
 * @param {string} secret - Raw webhook secret
 * @param {string} payload - String to sign (timestamp.payload)
 */
async function hmacSha256Hex(secret, payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyWebhook(payload, sigHeader, secret) {
  const { payload: signedPayload, expectedSignature, secret: s } = verifyWebhookSignature(payload, sigHeader, secret);
  const computed = await hmacSha256Hex(s, signedPayload);
  if (computed !== expectedSignature) {
    throw new Error("Stripe signature verification failed");
  }
  return JSON.parse(payload);
}

/**
 * Retrieve Checkout Session and PaymentIntent from Stripe.
 */
export async function retrieveCheckoutSession(stripeSecretKey, sessionId) {
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}?expand[]=payment_intent`, {
    headers: { Authorization: `Bearer ${stripeSecretKey}` },
  });
  if (!res.ok) throw new Error(`Stripe session: ${res.status}`);
  return res.json();
}

export async function retrievePaymentIntent(stripeSecretKey, paymentIntentId) {
  const res = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}`, {
    headers: { Authorization: `Bearer ${stripeSecretKey}` },
  });
  if (!res.ok) throw new Error(`Stripe payment_intent: ${res.status}`);
  return res.json();
}
