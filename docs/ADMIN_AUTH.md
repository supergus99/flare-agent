# Admin authentication

The admin area is **behind secure authentication**.

## How it works

1. **Login** – `POST /api/admin/login` with `{ "username", "password" }`. The Worker checks credentials against the `admin_users` table (password verified using `ADMIN_PASSWORD_SALT` + SHA-256 hash). No one can access admin data without valid credentials.

2. **Token** – On success, the Worker returns a **JWT** signed with `ADMIN_JWT_SECRET`. The token is short-lived (24 hours) and contains the admin user id.

3. **Protected routes** – Every admin API route requires a valid token:
   - `GET /api/admin/stats`
   - `GET /api/admin/submissions`
   - `GET /api/admin/payments`
   - `GET /api/admin/reports`
   - `POST /api/admin/reports/:id/approve`

   The Worker reads the token from the `Authorization: Bearer <token>` header (or the `admin_token` cookie). If the token is missing, invalid, or expired, the response is **401 Unauthorized**. No admin data is returned without a valid token.

4. **Admin UI** – `/admin.html` stores the JWT in `localStorage` and sends it with every request. If the user is not logged in, they only see the login form. If the token expires or is invalid, the API returns 401 and the UI redirects back to the login form.

## Summary

- **Admin page** (`/admin.html`) and all **admin API routes** are protected.
- Access is only granted after **successful login** with a username and password that match a row in `admin_users` (with correct password hash).
- Secrets `ADMIN_JWT_SECRET` and `ADMIN_PASSWORD_SALT` are required and must be set in the Worker; they are not exposed to the client.
