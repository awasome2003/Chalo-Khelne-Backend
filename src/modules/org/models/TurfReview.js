"use strict";
/**
 * TurfReview (Phase 5) — extracted from Turf.reviews[].
 *
 * A popular turf accumulated unbounded embedded reviews. Reviews now live in
 * their own collection, referenced by turfId. clubId (the turf owner) is carried
 * so reviews are tenant-scopable alongside the rest of the org module.
 */
const mongoose = require("mongoose");

const turfReviewSchema = new mongoose.Schema(
  {
    turfId: { type: mongoose.Schema.Types.ObjectId, ref: "Turf", required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    rating: { type: Number, min: 1, max: 5 },
    comment: { type: String, default: "" },
    // Tenant key — the turf's owner (ClubAdmin User _id). Stamped at migration
    // and on new writes from the parent turf.
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  },
  { timestamps: true }
);

// Hot path: a turf's reviews, newest first.
turfReviewSchema.index({ turfId: 1, createdAt: -1 });

const tenantScope = require("../../../../utils/tenantScope");
// Enforce after the migration backfills clubId on existing rows (new collection
// starts empty → 100% covered immediately).
turfReviewSchema.plugin(tenantScope, { field: "clubId", enforce: true });

module.exports = mongoose.models.TurfReview || mongoose.model("TurfReview", turfReviewSchema);
