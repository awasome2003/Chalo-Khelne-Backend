// models/Payment.js
const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  orderId: { type: String, required: true, unique: true },
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tournament",
    required: true,
  },
  // ── Tenant key (Phase 1.1 multi-tenancy) ──
  // Owning club = ClubAdmin/corporate_admin User _id. Derived from the payment's
  // tournament (eventId → Tournament.clubId) via the backfill script and stamped
  // on create from the request tenant context. Scoping runs in SHADOW MODE until
  // backfilled + verified.
  clubId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
    index: true,
  },
  amount: { type: Number, required: true },
  currency: { type: String, default: "INR" },
  status: {
    type: String,
    enum: [
      "created",
      "pending",
      "processing",
      "completed",
      "failed",
      "cancelled",
      "timeout",
    ],
    default: "created",
  },
  paymentMethod: {
    type: String,
    enum: ["card", "upi", "netbanking", "wallet", "any", "online"],
    default: "any",
    required: true,
  },
  paymentId: String,
  signature: String,
  receipt: String,
  error: {
    description: String,
    code: String,
    source: String,
    timestamp: Date,
    details: mongoose.Schema.Types.Mixed,
  },
  transactionDetails: {
    bankTransactionId: String,
    bankReference: String,
    upiTransactionId: String,
    merchantTransactionId: String,
    paymentNetwork: String,
    paymentMode: String,
    gatewayResponse: mongoose.Schema.Types.Mixed,
  },
  pendingReason: String,
  processingTimeout: Date,
  verificationAttempts: { type: Number, default: 0 },
  lastVerificationTime: Date,
  cancellation: {
    reason: String,
    timestamp: Date,
    initiatedBy: String,
    method: String,
    previousStatus: String,
  },
  retry: {
    count: { type: Number, default: 0 },
    lastAttempt: Date,
    nextAttemptAllowed: Date,
  },
  paymentDate: Date,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  expiresAt: Date,
});

// Add indexes for better query performance
// orderId unique index comes from the field-level `unique: true` (no dup here).
paymentSchema.index({ status: 1, createdAt: 1 });
paymentSchema.index({ eventId: 1, status: 1 });
// Tenant-aware compound index for club finance dashboards.
paymentSchema.index({ clubId: 1, status: 1, createdAt: -1 });

// Multi-tenant scoping (Phase 1.1) — ENFORCED (2026-06-02).
// Backfill stamped 2 of 99 payments; the other 97 are legacy orphans of deleted
// tournaments (verifyPaymentTenancy.js: mismatch=0, all nulls are orphans) —
// inert under enforcement (no club sees them). Scoping proof passed. To revert,
// set enforce:false. NOTE: .aggregate() pipelines are NOT yet scoped.
const tenantScope = require("../utils/tenantScope");
paymentSchema.plugin(tenantScope, {
  field: "clubId",
  enforce: true,
  // Payments are created by players (cross-tenant) — derive the tenant from the
  // tournament (eventId) when the request context can't supply it.
  derive: async (doc) => {
    if (!doc.eventId) return null;
    const t = await mongoose.model("Tournament").findById(doc.eventId).select("clubId").lean();
    return t ? t.clubId : null;
  },
});

module.exports = mongoose.model("Payment", paymentSchema);
