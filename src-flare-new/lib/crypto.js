/**
 * Generate secure random tokens for access_hash, verification_code, view_hash.
 * Uses Web Crypto available in Cloudflare Workers.
 */

/**
 * @param {number} bytes
 * @returns {Promise<string>} hex string
 */
async function randomHex(bytes = 16) {
  const buf = new Uint8Array(bytes);
  await crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * @returns {Promise<string>} 32-char hex access_hash
 */
export async function generateAccessHash() {
  return randomHex(16);
}

/**
 * @returns {Promise<string>} 6-char alphanumeric verification code (e.g. for email)
 */
export async function generateVerificationCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = new Uint8Array(6);
  await crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => chars[b % chars.length])
    .join('');
}

/**
 * @returns {Promise<string>} 32-char hex view_hash for report links
 */
export async function generateViewHash() {
  return randomHex(16);
}
