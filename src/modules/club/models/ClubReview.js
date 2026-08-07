const mongoose = require("mongoose");

/**
 * ClubReview — a testimonial about a facility Club, a coach, or a court (Club OS).
 * Tenant-scoped by clubId. Admin can reply. Distinct from the turf-marketplace
 * `TurfReview`. (Customer-facing submission is a later integration; for now the
 * admin can record + reply to reviews.)
 */
const clubReviewSchema = new mongoose.Schema(
  {
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    author: { type: String, required: true, trim: true },
    targetType: { type: String, enum: ["Club", "Coach", "Court"], default: "Club" },
    targetName: { type: String, default: "" },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: "" },
    reply: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

clubReviewSchema.index({ clubId: 1, createdAt: -1 });

module.exports = mongoose.model("ClubReview", clubReviewSchema);
