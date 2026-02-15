# Flare

Cloudflare replica: Workers, D1, R2, Queues, Pages.

## Smoke tests

Smoke tests hit the Worker HTTP API to verify main routes and auth behavior.

**Run against local Worker:**

```bash
npx wrangler dev
# In another terminal:
BASE_URL=http://localhost:8787 npm run smoke
# or
npm run smoke
```

**Run against deployed Worker:**

```bash
BASE_URL=https://flare-worker.<your-subdomain>.workers.dev npm run smoke
```

Tests cover: health, `/db`, `/r2`, `/queue`, assessment template, assessments POST (validation), report view, admin 401 without auth, admin login (wrong creds), checkout (not configured), CORS OPTIONS, 404.
