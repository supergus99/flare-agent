# Using getflare.net with Flare

Steps to serve Flare from **getflare.net** (and **www.getflare.net**) with the API on **api.getflare.net**.

---

## 1. Add the domain to Cloudflare

1. In [Cloudflare Dashboard](https://dash.cloudflare.com) → **Websites** → **Add a site** (or use an existing site).
2. Enter **getflare.net** and follow the prompts. Cloudflare will show the nameservers to use (e.g. `*.ns.cloudflare.com`).
3. At your domain registrar (where you bought getflare.net), set the **nameservers** to the ones Cloudflare gave you. Wait for propagation (minutes to 48 hours).

---

## 2. Custom domain for Pages (frontend)

1. **Workers & Pages** → your **Pages** project (e.g. the one that serves `public/` from the flare repo).
2. Go to **Custom domains** → **Set up a custom domain**.
3. Add **getflare.net**. Cloudflare will create the DNS record (CNAME or A/AAAA) in your zone. Add **www.getflare.net** as well if you want the www variant.
4. Wait for SSL to be active (usually automatic). Your site will be live at `https://getflare.net` and optionally `https://www.getflare.net`.

---

## 3. Custom domain for the Worker (API)

1. **Workers & Pages** → **flare-worker** → **Triggers** → **Custom Domains** → **Add**.
2. Enter **api.getflare.net** (or a subdomain you prefer). Cloudflare will add the DNS record (CNAME) for that hostname to your zone.
3. Save. Once SSL is active, the Worker will respond at `https://api.getflare.net`.

**If `https://api.getflare.net/api/webhooks/stripe` (or any path) returns “Not found”:** The domain is not attached to this Worker. In **Workers & Pages** → **flare-worker** → **Triggers** → **Custom Domains**, confirm **api.getflare.net** is listed. If it’s missing, add it as above. Until then, use the Worker’s **workers.dev** URL (e.g. `https://flare-worker.<subdomain>.workers.dev`) for Stripe webhooks and any API calls.

---

## 4. Worker secrets (redirects and Stripe)

Set these in **Workers & Pages** → **flare-worker** → **Settings** → **Variables and Secrets** (or via `wrangler secret put`):

| Secret / variable | Value |
|-------------------|--------|
| `WORKER_PUBLIC_URL` | `https://api.getflare.net` |
| `SUCCESS_BASE_URL` | `https://getflare.net` (or `https://www.getflare.net` if you use www) |

- **WORKER_PUBLIC_URL** is used for Stripe Checkout `success_url` and for report/assessment links in emails.
- **SUCCESS_BASE_URL** is where the Worker redirects after payment (e.g. `https://getflare.net/success.html?hash=...`).

Redeploy the Worker after changing secrets (e.g. push to `main` or run `npx wrangler deploy`).

---

## 5. Stripe webhook

1. In [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks), edit your existing webhook (or add one).
2. Set the endpoint URL to: **`https://api.getflare.net/api/webhooks/stripe`** (or use the workers.dev URL below if the custom domain returns 404).
3. Keep the same events (e.g. `checkout.session.completed`).
4. If you created a new endpoint, copy the **Signing secret** and set the Worker secret **STRIPE_WEBHOOK_SECRET** to that value.

**If `https://api.getflare.net/api/webhooks/stripe` returns 404:** The domain is not reaching the Worker. Either add **api.getflare.net** as a Custom Domain for **flare-worker** (Workers & Pages → flare-worker → Triggers → Custom Domains → Add), or use the Worker’s **workers.dev** URL for the webhook instead: **`https://flare-worker.<your-subdomain>.workers.dev/api/webhooks/stripe`**. You can find the exact URL in Workers & Pages → flare-worker (it’s shown on the overview). The webhook will work the same; only the hostname differs.

---

## 6. Frontend (no code change needed for getflare.net)

The static pages (checkout, assessment, contact, admin, success) already use **api.getflare.net** when the site is opened from **getflare.net** or **www.getflare.net**. If you use a different hostname (e.g. another domain), set `window.FLARE_WORKER_URL` before any script runs, or update the hostname check in those pages.

---

## Checklist

- [ ] Domain getflare.net on Cloudflare (nameservers updated at registrar).
- [ ] Pages custom domain: getflare.net (and optionally www.getflare.net).
- [ ] Worker custom domain: api.getflare.net.
- [ ] Worker secrets: `WORKER_PUBLIC_URL` = `https://api.getflare.net`, `SUCCESS_BASE_URL` = `https://getflare.net`.
- [ ] Stripe webhook URL: `https://api.getflare.net/api/webhooks/stripe`.
- [ ] Test: open `https://getflare.net` → Checkout → pay (test mode) → confirm redirect to `https://getflare.net/success.html?hash=...` and that assessment/report links use `https://api.getflare.net`.
