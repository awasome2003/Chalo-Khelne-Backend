// Request.js - Enhanced Model for training requests
const mongoose = require("mongoose");

const RequestSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ["player", "club"],
    required: true,
  },
  playerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  playerName: {
    type: String,
  },
  clubId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Club",
  },
  clubName: {
    type: String,
  },
  trainerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  // New field to reference a specific session for join requests
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Session",
  },
  requestType: {
    type: String,
    enum: ["new_session", "join_session"],
    default: "new_session",
  },
  requestedDate: {
    type: String,
    required: true,
  },
  requestedTime: {
    type: String,
    required: true,
  },
  sessionType: {
    type: String,
    enum: ["personal", "group", "intermediate", "academy"],
    required: true,
  },
  location: {
    type: String,
  },
  notes: {
    type: String,
  },
  price: {
    type: Number,
    default: 0,
  },
  sportType: {
    type: String,
    default: "General",
  },
  status: {
    type: String,
    enum: ["pending", "accepted", "rejected", "cancelled"],
    default: "pending",
  },
  paymentStatus: {
    type: String,
    enum: ["pending", "completed", "refunded", "cancelled"],
    default: "pending",
  },
  // For "My Training" section tracking
  displayed: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Add pre-save hook to update the updatedAt field
RequestSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

// Trainer console queries: dashboard count {trainerId,type,status} and
// listRequests {trainerId,type} sort createdAt — both served by this prefix index.
RequestSchema.index({ trainerId: 1, type: 1, status: 1, createdAt: -1 });

// ── Tenancy decision (Phase 5): GENUINELY CROSS-TENANT — no plugin ────
// Request is a training request between a trainer and a player. Both are
// cross-tenant principals (they carry NO clubId context), and the `clubId`
// field here refs the **Club** collection (a directory id), NOT the SaaS tenant
// (a ClubAdmin User _id). So tenantScope could never match and shadow mode was a
// permanent no-op. Removed. Isolation is by trainerId/playerId controller
// filters, which is correct for a cross-tenant relationship model.

module.exports = mongoose.model("Request", RequestSchema);
