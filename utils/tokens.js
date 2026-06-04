/**
 * Token helpers (Phase 8.1 + 9) — short-lived access JWT + rotating refresh tokens.
 *
 *   access  = 1h HS256 JWT (payload shape varies by principal type)
 *   refresh = 30d opaque random, stored hashed in the RefreshToken collection
 *
 * Principals: "User" (mobile app, multi-device), "Manager"/"Superadmin"
 * (web panel — single-session: a new login revokes prior refresh tokens).
 */
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const RefreshToken = require("../Modal/RefreshToken");

const ACCESS_TTL = "1h";
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const hash = (raw) => crypto.createHash("sha256").update(raw).digest("hex");

// Access-token payload per principal type. Matches what authMiddleware expects:
// User/Manager → decoded.id; Superadmin → decoded.userId (+ role claim).
function signAccessTokenFor(principal, principalType = "User") {
  let payload;
  if (principalType === "Manager") {
    payload = { id: principal._id, role: "Manager" };
  } else if (principalType === "Superadmin") {
    payload = { email: principal.email, role: "superadmin", userId: principal._id };
  } else {
    payload = { id: principal._id, role: principal.role, email: principal.email };
  }
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: ACCESS_TTL });
}

// Back-compat alias for the existing User flow.
const signAccessToken = (user) => signAccessTokenFor(user, "User");

/** Revoke every active refresh token for a principal (single-session enforcement). */
async function revokeAllForPrincipal(principalId, principalType = "User") {
  await RefreshToken.updateMany(
    { userId: principalId, principalType, revoked: false },
    { $set: { revoked: true } }
  );
}

/**
 * Create + persist a refresh token; returns the RAW token (only the hash is stored).
 * opts: { principalType="User", singleSession=false, userAgent="" }
 */
async function issueRefreshToken(principalId, opts = {}) {
  const principalType = opts.principalType || "User";
  if (opts.singleSession) await revokeAllForPrincipal(principalId, principalType);
  const raw = crypto.randomBytes(48).toString("hex");
  await RefreshToken.create({
    userId: principalId,
    principalType,
    tokenHash: hash(raw),
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    userAgent: opts.userAgent || "",
  });
  return raw;
}

/**
 * Validate + rotate a refresh token. Returns { principalId, principalType,
 * refreshToken } on success, or { error: "invalid"|"reuse"|"expired" }. On
 * "reuse" (a revoked token presented) the principal's whole chain is revoked.
 */
async function rotateRefreshToken(rawToken, meta = {}) {
  if (!rawToken) return { error: "invalid" };
  const existing = await RefreshToken.findOne({ tokenHash: hash(rawToken) });
  if (!existing) return { error: "invalid" };
  const principalType = existing.principalType || "User"; // tokens issued before this field default to User
  if (existing.revoked) {
    await revokeAllForPrincipal(existing.userId, principalType);
    return { error: "reuse" };
  }
  if (existing.expiresAt < new Date()) return { error: "expired" };

  const newRaw = await issueRefreshToken(existing.userId, {
    principalType,
    userAgent: meta.userAgent,
  });
  existing.revoked = true;
  existing.replacedByHash = hash(newRaw);
  await existing.save();
  return { principalId: existing.userId, principalType, refreshToken: newRaw };
}

/** Revoke a single refresh token (logout). Idempotent. */
async function revokeRefreshToken(rawToken) {
  if (!rawToken) return;
  await RefreshToken.updateOne({ tokenHash: hash(rawToken) }, { $set: { revoked: true } });
}

module.exports = {
  signAccessToken,
  signAccessTokenFor,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForPrincipal,
  ACCESS_TTL,
};
