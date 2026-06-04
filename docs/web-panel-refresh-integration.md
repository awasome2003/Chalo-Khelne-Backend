# Web Panel — Refresh-Token Integration Spec

For the Manager / SuperAdmin **web panel** developer. The backend already issues
rotating refresh tokens for Manager and Superadmin logins (single-session). This
doc describes what the web panel must implement to use them, and the one-line
backend "activation" step that shortens access tokens once the panel is ready.

> Status: backend infra is **live**. Manager/Superadmin **access tokens are still
> long-lived (30d / 1h)** — the refresh flow is dormant until you ship the
> interceptor below AND we flip access to 1h (see *Activation*). Do **not** flip
> before the panel handles refresh-on-401, or managers get logged out hourly.

---

## 1. Endpoints (already deployed)

### `POST /api/auth/refresh`
Exchange a refresh token for a new access token (rotates the refresh token).

- Request: `{ "refreshToken": "<raw refresh token>" }`
- `200`: `{ "token": "<new access JWT>", "refreshToken": "<new refresh token>" }`
- `401`: refresh token invalid / expired / revoked → **force re-login**

No `Authorization` header required (the access token is expired by design).

### `POST /api/auth/logout`
Revoke a refresh token (real server-side logout / kill-switch).

- Request: `{ "refreshToken": "<raw refresh token>" }`
- `200`: `{ "success": true }` (always succeeds; best-effort)

### Login responses (Manager / Superadmin)
`POST /api/login` (manager/superadmin) and `POST /api/superadminlogin` now return
a `refreshToken` field **alongside** the existing `token`:

```json
{ "token": "<access JWT>", "refreshToken": "<refresh token>", "user": { ... } }
```

Store **both**. Keep the access token where you keep it today; store the refresh
token securely (httpOnly cookie preferred, or secure storage).

---

## 2. What the web panel must implement

### a) Persist both tokens on login
On login success, save `token` (access) and `refreshToken`.

### b) Axios response interceptor — refresh on 401 (with single-flight queue)
```js
import axios from "axios";

let isRefreshing = false;
let queue = [];
const flush = (err, token) => {
  queue.forEach((p) => (err ? p.reject(err) : p.resolve(token)));
  queue = [];
};

// IMPORTANT: use a BARE client (no interceptors) for the refresh call itself,
// so a 401 from /auth/refresh can't recurse into this interceptor.
const bare = axios.create();

async function doRefresh() {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) throw new Error("no_refresh_token");
  const { data } = await bare.post("/api/auth/refresh", { refreshToken });
  if (!data?.token) throw new Error("refresh_failed");
  storeTokens(data.token, data.refreshToken); // persist rotated pair
  return data.token;
}

axios.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config;
    if (error?.response?.status !== 401 || !original || original._retry) {
      return Promise.reject(error);
    }
    // never refresh the auth endpoints themselves
    if (/\/auth\/refresh|\/login|\/superadminlogin/.test(original.url || "")) {
      forceLogout();
      return Promise.reject(error);
    }
    if (isRefreshing) {
      // wait for the in-flight refresh, then retry with the new token
      return new Promise((resolve, reject) => queue.push({ resolve, reject })).then((token) => {
        original._retry = true;
        original.headers = { ...original.headers, Authorization: `Bearer ${token}` };
        return axios(original);
      });
    }
    original._retry = true;
    isRefreshing = true;
    try {
      const newToken = await doRefresh();
      flush(null, newToken);
      original.headers = { ...original.headers, Authorization: `Bearer ${newToken}` };
      return axios(original);
    } catch (e) {
      flush(e, null);
      forceLogout(); // clear tokens + redirect to login
      return Promise.reject(error);
    } finally {
      isRefreshing = false;
    }
  }
);
```

### c) Logout
Before clearing local state, call:
```js
await axios.post("/api/auth/logout", { refreshToken: getStoredRefreshToken() });
```

### d) (Optional) cold-start refresh
If the stored access token is already expired on app load, call `doRefresh()`
before the first protected request instead of bouncing the user to login.

---

## 3. Single-session behavior (by design)

A new Manager/Superadmin login **revokes all prior refresh tokens for that
account**. Other tabs/devices logged into the same account will get a `401` →
their refresh will fail → they re-login. This is intentional (single active
session per manager/superadmin). Users (mobile app) are **multi-device** and are
not affected.

---

## 4. Activation step (backend — do AFTER the panel ships the above)

Access tokens for Manager/Superadmin are still long-lived so the panel keeps
working today. Once the interceptor above is live, shorten them so the refresh
flow actually engages:

In `routes/authRoutes.js`, at the **Manager login branch**, the
**Superadmin-in-/login branch**, and **/superadminlogin**, replace the
`jwt.sign(..., { expiresIn: "30d" | "1h" })` access-token line with the helper:

```js
const { signAccessTokenFor } = require("../utils/tokens");
// Manager branch:
const token = signAccessTokenFor(manager, "Manager");      // 1h
// Superadmin branches:
const token = signAccessTokenFor(superadmin, "Superadmin"); // 1h
```

(`signAccessTokenFor` already issues 1h tokens with the correct per-type payload.)
These three lines are marked with `Phase 9` comments in the code.

---

## 5. Security notes

- Refresh tokens are random opaque strings; only their SHA-256 hash is stored
  server-side (`RefreshToken` collection), with a 30-day TTL auto-purge.
- Rotation: each `/auth/refresh` revokes the presented token and issues a new
  one. Presenting an already-revoked token triggers **reuse detection** — the
  account's whole refresh-token chain is revoked (theft signal) → re-login.
- Prefer storing the refresh token in an httpOnly, Secure, SameSite cookie on
  the web panel rather than `localStorage`.
