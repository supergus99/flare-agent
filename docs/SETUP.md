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

## 3. D1 (database)

1. **Create the database** (from the flare repo, with Node/Wrangler installed):
   ```bash
   cd ~/projects/flare
   npx wrangler d1 create flare-db
   ```
   Copy the **database_id** from the output.

2. **Bind D1 to the Worker:** In `wrangler.toml`, uncomment the `[[d1_databases]]` block and replace `YOUR_D1_DATABASE_ID` with the id from step 1.

3. **Run the migration** (creates `contact_submissions` table):
   ```bash
   npx wrangler d1 execute flare-db --remote --file=./migrations/001_initial.sql
   ```

4. **Deploy:** Commit and push; CI will deploy with D1. Or run `npx wrangler deploy` locally.

5. **Test:** Open `https://flare-worker.<your-subdomain>.workers.dev/db` – you should see `{"d1":"ok","submissions_count":0}`.

---

## 4. R2 (object storage for reports)

1. **Create the bucket:** Cloudflare Dashboard → **Workers R2 Storage** → **Create bucket** → name: **flare-reports**, location Automatic, leave public access **off**.
2. **Binding** is already in `wrangler.toml` (`REPORTS` → `flare-reports`). Deploy (push to main or `npx wrangler deploy`).
3. **Test:** Open `https://flare-worker.gusmao-ricardo.workers.dev/r2` – you should see `{"r2":"ok","bucket":"flare-reports"}`.

---

## 5. Queues (when you add it)

- Create queue: **flare-jobs**
- Add producer/consumer bindings in `wrangler.toml`

---

## 6. Pages (optional)

- **Cloudflare: Pages** → Connect to Git → select **flare** repo, branch **main**, build output as needed.
