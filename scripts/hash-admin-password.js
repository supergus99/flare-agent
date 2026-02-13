#!/usr/bin/env node
/**
 * Generate password_hash for admin_users (Phase 3).
 * Usage: SALT="your_admin_password_salt" PASSWORD="your_password" node scripts/hash-admin-password.js
 * Then set ADMIN_PASSWORD_SALT in Cloudflare to the same SALT, and UPDATE admin_users SET password_hash = '<output>';
 */
const crypto = require("crypto");
const salt = process.env.SALT || "";
const password = process.env.PASSWORD || "";
if (!salt || !password) {
  console.error("Usage: SALT=\"your_salt\" PASSWORD=\"your_password\" node scripts/hash-admin-password.js");
  process.exit(1);
}
const s = (salt || "").trim();
const hash = crypto.createHash("sha256").update(s + password).digest("hex");
console.log(hash);
if (hash.length !== 64) console.error("Expected 64-char hash, got", hash.length);
