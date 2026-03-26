const mongoose = require("mongoose");

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: 20,
    },
    discountType: {
      type: String,
      required: true,
      enum: ["percentage", "flat"],
    },
    discountValue: {
      type: Number,
      required: true,
      min: 0,
    },
    // What this coupon applies to
    applicableTo: {
      type: String,
      required: true,
      enum: ["facility", "tournament", "all"],
    },
    // Specific facility/tournament ID (null = applies to all of that type)
    applicableId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    applicableName: {
      type: String,
      default: null,
      trim: true,
    },
    // Usage limits
    usageLimit: {
      type: Number,
      default: null, // null = unlimited
      min: 1,
    },
    perUserLimit: {
      type: Number,
      default: 1, // each user can use this coupon N times
      min: 1,
    },
    usedCount: {
      type: Number,
      default: 0,
    },
    // Validity
    expiryDate: {
      type: Date,
      required: true,
    },
    // Minimum order amount
    minAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Maximum discount (for percentage coupons)
    maxDiscount: {
      type: Number,
      default: null, // null = no cap
      min: 0,
    },
    // Status
    isActive: {
      type: Boolean,
      default: true,
    },
    // Creator
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    createdByModel: {
      type: String,
      enum: ["Manager", "User"],
      default: "Manager",
    },
    createdByName: {
      type: String,
      trim: true,
    },
    // Optional description
    description: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },
  },
  { timestamps: true }
);

couponSchema.index({ code: 1 });
couponSchema.index({ isActive: 1, expiryDate: 1 });
couponSchema.index({ applicableTo: 1, applicableId: 1 });
couponSchema.index({ createdBy: 1 });

module.exports = mongoose.model("Coupon", couponSchema);
