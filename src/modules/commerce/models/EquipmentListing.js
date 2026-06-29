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
    brand: { type: String, trim: true, default: "" },
    size: { type: String, trim: true, default: "" },
    color: { type: String, trim: true, default: "" },
    // Unit of sale: "single" = sold per piece; "pack" = sold as a box/set of
    // `packSize` pieces. Price & quantity refer to this unit.
    sellUnit: { type: String, enum: ["single", "pack"], default: "single" },
    packSize: { type: Number, min: 1, default: 1 },
    quantity: { type: Number, min: 1, default: 1 },
    usageDuration: { type: String, trim: true, default: "" },
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
    // Pre-approval lifecycle. New listings land in "pending" and require admin
    // approval before they appear in the public Store feed.
    lifecycleStatus: {
      type: String,
      enum: ["pending", "approved"],
      default: "pending",
    },
    views: {
      type: Number,
      default: 0,
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
      enum: ["qr", "upi", "card", "wallet", "offline", null],
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
    // Order lifecycle after claim — drives the My Orders / Track Order UI
    deliveryStatus: {
      type: String,
      enum: [
        "confirmed",
        "packed",
        "shipped",
        "out_for_delivery",
        "delivered",
        "cancelled",
        null,
      ],
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
    // Shipping / seller details captured at listing time (used to ship the item)
    shippingAddress: {
      mobile: { type: String, default: "" },
      email: { type: String, default: "" },
      address: { type: String, default: "" },
      pincode: { type: String, default: "" },
      state: { type: String, default: "" },
      city: { type: String, default: "" },
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

    // ── Vendor middleman workflow (player → vendor → store) ──
    // The QC/refurbish pipeline. A new player upload starts at "pending_review"
    // (visible only to the platform vendor). The store shows ONLY "listed".
    vendorStatus: {
      type: String,
      enum: [
        "pending_review",     // seller uploaded; awaiting vendor
        "rejected",           // vendor rejected
        "offer_made",         // vendor accepted with an offer; awaiting seller
        "offer_declined",     // seller declined the offer
        "ready_for_pickup",   // seller accepted; awaiting vendor pickup
        "acquired",           // vendor received it (refurbishing)
        "listed",             // vendor published; live in the store
        "sold",               // bought by a player
      ],
      default: "pending_review",
    },
    handledByVendor: { type: mongoose.Schema.Types.ObjectId, ref: "VendorProfile", default: null },
    vendorOffer: {
      purchasePrice: { type: Number, default: null },
      repairNeeded: { type: Boolean, default: false },
      repairCost: { type: Number, default: 0 },
      repairDescription: { type: String, default: "" },
      pickupDate: { type: Date, default: null },
      offeredAt: { type: Date, default: null },
    },
    sellerOfferResponse: { type: String, enum: ["pending", "accepted", "declined"], default: "pending" },
    sellerRespondedAt: { type: Date, default: null },
    vendorSalePrice: { type: Number, default: null, min: 0 }, // resale price set by vendor
    rejectionReason: { type: String, default: "" },
    // Milestone timestamps for the seller-facing status tracker (real dates,
    // not derived). Set as the vendor advances the product through pickup →
    // publish. offeredAt/sellerRespondedAt live above and cover the earlier steps.
    vendorTimeline: {
      pickedUpAt: { type: Date, default: null },
      listedAt: { type: Date, default: null },
      soldAt: { type: Date, default: null },
    },
  },
  {
    timestamps: true,
  }
);

equipmentListingSchema.index({ vendorStatus: 1 });
equipmentListingSchema.index({ handledByVendor: 1 });
equipmentListingSchema.index({ status: 1 });
equipmentListingSchema.index({ sport: 1 });
equipmentListingSchema.index({ category: 1 });
equipmentListingSchema.index({ seller: 1 });
equipmentListingSchema.index({ claimedBy: 1 });
equipmentListingSchema.index({ isDonation: 1 });
equipmentListingSchema.index({ askingPrice: 1 });
equipmentListingSchema.index({ createdAt: -1 });

module.exports = mongoose.model("EquipmentListing", equipmentListingSchema);
