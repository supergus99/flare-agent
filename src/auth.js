/**
 * Simple JWT sign/verify (HS256) and admin password check (Phase 3).
 * For production consider a proper JWT library; this is minimal for admin-only.
 */

const encoder = new TextEncoder();

function base64UrlEncode(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Sign a JWT (HS256).
 * @param {string} secret - ADMIN_JWT_SECRET
 * @param {object} payload - { sub, exp, ... }
 * @returns {Promise<string>}
 */
export async function signJwt(secret, payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = base64UrlEncode(
    new Uint8Array(encoder.encode(JSON.stringify(header)))
  );
  const payloadB64 = base64UrlEncode(
    new Uint8Array(encoder.encode(JSON.stringify(payload)))
  );
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(signingInput)
  );
  const sigB64 = base64UrlEncode(new Uint8Array(sig));
  return `${signingInput}.${sigB64}`;
}

/**
 * Verify and decode JWT. Returns payload or null.
 * @param {string} secret - ADMIN_JWT_SECRET
 * @param {string} token
 * @returns {Promise<object | null>}
 */
export async function verifyJwt(secret, token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const sigBytes = base64UrlDecode(sigB64);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    encoder.encode(signingInput)
  );
  if (!valid) return null;
  try {
    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(payloadB64))
    );
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

/**
 * Hash password for admin comparison: SHA-256(salt + password) as hex.
 * @param {string} salt - ADMIN_PASSWORD_SALT
 * @param {string} password
 * @returns {Promise<string>}
 */
export async function hashAdminPassword(salt, password) {
  const s = (salt || "").trim();
  const buf = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(s + password)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
