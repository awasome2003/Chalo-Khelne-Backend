const mongoose = require("mongoose");

/**
 * Refresh tokens (Phase 8.1). One document per issued refresh token, so a user
 * can have several concurrent sessions (multi-device). Only the SHA-256 hash of
 * the token is stored — the raw token lives only on the client.
 *
 * Rotation: each /auth/refresh revokes the presented token and issues a new one
 * (replacedByHash links the chain). Reuse of a revoked token → theft signal →
 * the whole user's chain is revoked (handled in utils/tokens.rotateRefreshToken).
 */
const RefreshTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true }, // principal id (User/Manager/Superadmin)
    principalType: { type: String, enum: ["User", "Manager", "Superadmin"], default: "User", index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true },
    revoked: { type: Boolean, default: false },
    replacedByHash: { type: String, default: null },
    userAgent: { type: String, default: "" },
  },
  { timestamps: true }
);

// Auto-purge expired tokens from the collection.
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("RefreshToken", RefreshTokenSchema);
