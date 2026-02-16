#!/usr/bin/env node
/**
 * One-off: send a test email via Resend API.
 * Usage: node scripts/send-test-email.mjs [to_email]
 * Reads RESEND_API_KEY from .dev.vars in project root.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const devVarsPath = join(root, ".dev.vars");

let apiKey = process.env.RESEND_API_KEY;
if (!apiKey) {
  try {
    const content = readFileSync(devVarsPath, "utf8");
    const line = content.split("\n").find((l) => l.startsWith("RESEND_API_KEY="));
    if (line) apiKey = line.replace(/^RESEND_API_KEY=/, "").trim();
  } catch (_) {}
}
if (!apiKey) {
  console.error("RESEND_API_KEY not found in .dev.vars or env");
  process.exit(1);
}

const to = process.argv[2] || "marketing@strsecure.com";
const from = "Flare <onboarding@resend.dev>";
const subject = "Flare – email test";
const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:system-ui,sans-serif;padding:1rem;"><p>If you received this, Resend is working.</p><p><strong>Flare</strong></p></body></html>`;

const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ from, to: [to], subject, html }),
});
const data = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error("Resend error:", res.status, data);
  process.exit(1);
}
console.log("Sent to", to, "– id:", data.id);
