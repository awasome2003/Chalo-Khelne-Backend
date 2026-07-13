const mongoose = require("mongoose");

/**
 * ClubCoupon — a promo code offered by a facility Club (Club OS). Tenant-scoped
 * by clubId. Distinct from the tournament/manager `Coupon` model (which is
 * couponType-scoped with a Manager/User creator). Codes are unique per club.
 */
const clubCouponSchema = new mongoose.Schema(
  {
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    discountType: { type: String, enum: ["Percentage", "Flat"], default: "Percentage" },
    value: { type: Number, default: 0, min: 0 },
    validFrom: { type: String, default: "" }, // YYYY-MM-DD
    validUntil: { type: String, default: "" }, // YYYY-MM-DD
    usageLimit: { type: Number, default: 100, min: 0 },
    usedCount: { type: Number, default: 0, min: 0 },
    applicableSports: { type: [String], default: [] },
    membershipOnly: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// Code unique within a club (not globally).
clubCouponSchema.index({ clubId: 1, code: 1 }, { unique: true });

module.exports = mongoose.model("ClubCoupon", clubCouponSchema);
