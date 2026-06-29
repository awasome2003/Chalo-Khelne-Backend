const mongoose = require("mongoose");

const couponUsageSchema = new mongoose.Schema(
  {
    couponId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coupon",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    couponCode: {
      type: String,
      required: true,
    },
    // What it was applied to
    appliedTo: {
      type: String,
      enum: ["facility", "tournament"],
      required: true,
    },
    appliedId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    // Amounts
    originalAmount: {
      type: Number,
      required: true,
    },
    discountAmount: {
      type: Number,
      required: true,
    },
    finalAmount: {
      type: Number,
      required: true,
    },
  },
  { timestamps: true }
);

// Compound index for per-user usage tracking
couponUsageSchema.index({ couponId: 1, userId: 1 });
couponUsageSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("CouponUsage", couponUsageSchema);
