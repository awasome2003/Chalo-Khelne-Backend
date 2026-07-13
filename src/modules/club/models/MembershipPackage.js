const mongoose = require("mongoose");

/**
 * MembershipPackage — a subscription plan offered by a facility Club (Club OS).
 * Tenant-scoped by clubId. Members subscribe to a package.
 */
const membershipPackageSchema = new mongoose.Schema(
  {
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true },
    price: { type: Number, default: 0, min: 0 },
    validity: { type: String, enum: ["Monthly", "Quarterly", "Yearly"], default: "Monthly" },
    sports: { type: [String], default: [] },
    bookingLimit: { type: String, default: "Unlimited Access" },
    guestAccess: { type: Boolean, default: false },
    benefits: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

membershipPackageSchema.index({ clubId: 1, createdAt: 1 });

module.exports = mongoose.model("MembershipPackage", membershipPackageSchema);
