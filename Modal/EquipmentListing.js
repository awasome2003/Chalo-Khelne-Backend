const mongoose = require("mongoose");

const equipmentListingSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sellerName: {
      type: String,
      required: true,
      trim: true,
    },
    sellerLevel: {
      type: String,
      enum: ["district", "state", "national", "international", "club", "beginner"],
      default: "club",
    },
    sport: {
      type: String,
      required: true,
      trim: true,
    },
    itemName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },
    description: {
      type: String,
      required: true,
      maxlength: 1000,
    },
    category: {
      type: String,
      required: true,
      enum: [
        "Racket",
        "Bat",
        "Shoes",
        "Jersey",
        "Ball",
        "Net",
        "Protective Gear",
        "Accessories",
        "Other",
      ],
    },
    condition: {
      type: String,
      required: true,
      enum: ["Like New", "Good", "Fair", "Used"],
    },
    originalPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    askingPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    isDonation: {
      type: Boolean,
      default: false,
    },
    images: [
      {
        type: String,
      },
    ],
    status: {
      type: String,
      enum: ["Active", "Reserved", "Sold", "Withdrawn"],
      default: "Active",
    },
    // Claim / Purchase fields
    claimedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    claimedByName: {
      type: String,
      default: null,
    },
    claimedAt: {
      type: Date,
      default: null,
    },
    // Payment fields (for paid items)
    paymentMethod: {
      type: String,
      enum: ["qr", "upi", "offline", null],
      default: null,
    },
    paymentScreenshot: {
      type: String,
      default: null,
    },
    transactionId: {
      type: String,
      default: null,
    },
    paymentStatus: {
      type: String,
      enum: ["Pending", "Verified", "Rejected", null],
      default: null,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    // Contact sharing (after claim is approved)
    sellerContact: {
      type: String,
      default: null,
    },
    buyerContact: {
      type: String,
      default: null,
    },

    // ── Vendor Marketplace Fields (managed by SuperAdmin) ──
    vendorLink: {
      type: String,
      default: null,
      trim: true,
    },
    vendorName: {
      type: String,
      default: null,
      trim: true,
      maxlength: 200,
    },
    vendorPrice: {
      type: Number,
      default: null,
      min: 0,
    },
    vendorLinkAddedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Superadminmodel",
      default: null,
    },
    vendorLinkAddedAt: {
      type: Date,
      default: null,
    },
    vendorClickCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

equipmentListingSchema.index({ status: 1 });
equipmentListingSchema.index({ sport: 1 });
equipmentListingSchema.index({ category: 1 });
equipmentListingSchema.index({ seller: 1 });
equipmentListingSchema.index({ claimedBy: 1 });
equipmentListingSchema.index({ isDonation: 1 });
equipmentListingSchema.index({ askingPrice: 1 });
equipmentListingSchema.index({ createdAt: -1 });

module.exports = mongoose.model("EquipmentListing", equipmentListingSchema);
