# Flare – Setup Guide

Step-by-step setup: GitHub, CI/CD, D1, R2, Workers, Queues, Pages.

---

## 1. GitHub secrets (do first)

In your **flare** repo → **Settings** → **Secrets and variables** → **Actions**:

| Secret name | Value |
|-------------|--------|
| `CLOUDFLARE_API_TOKEN` | Your Cloudflare API token (Workers + D1 + R2 + Queues + Pages: Edit) |
| `CLOUDFLARE_ACCOUNT_ID` | From Cloudflare Dashboard → Workers & Pages → Account ID |

---

## 2. Deploy the Worker (CI)

After secrets are set, push to `main`:

```bash
cd ~/projects/flare
git add .
git commit -m "Add Worker and CI"
git push origin main
```

GitHub Actions will run and deploy **flare-worker** to Cloudflare. Check the **Actions** tab; when green, the Worker is live at `https://flare-worker.<your-subdomain>.workers.dev`.

---

## 3. D1 (when you add it)

- Create: `npx wrangler d1 create flare-db`
- Add to `wrangler.toml`: `[[d1_databases]]` with `binding = "DB"`, `database_name = "flare-db"`, `database_id = "<id>"`
- Migrations: `migrations/001_initial.sql` then `npx wrangler d1 execute flare-db --remote --file=./migrations/001_initial.sql`

---

## 4. R2 (when you add it)

- Create bucket: **Workers R2 Storage** → Create bucket → **flare-reports** (private, Automatic location)
- Add to `wrangler.toml`: `[[r2_buckets]]` with `binding = "REPORTS"`, `bucket_name = "flare-reports"`

---

## 5. Queues (when you add it)

- Create queue: **flare-jobs**
- Add producer/consumer bindings in `wrangler.toml`

---

## 6. Pages (optional)

- **Cloudflare: Pages** → Connect to Git → select **flare** repo, branch **main**, build output as needed.
