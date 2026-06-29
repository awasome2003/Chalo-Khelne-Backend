// models/TurfBookingModel.js
const mongoose = require("mongoose");

const turfBookingSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    userName: {
      type: String,
      required: true,
    },
    userEmail: {
      type: String,
    },
    userPhone: {
      type: String,
    },
    turfId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Turf",
      required: true,
    },
    turfName: {
      type: String,
      required: true,
    },
    // Added sport field to match your Turf model sports array
    sport: {
      name: {
        type: String,
        required: true,
      },
      pricePerHour: {
        type: Number,
        required: true,
      },
    },
    date: {
      type: Date,
      required: true,
    },
    timeSlot: {
      type: String,
      required: true,
    },
    // Which physical court the slot was booked on. Optional so existing
    // turfs/bookings without courts configured still validate.
    court: {
      name: { type: String, default: "" },
      type: { type: String, default: "" },
    },
    amount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "cancelled", "completed"],
      default: "confirmed",
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "refunded"],
      default: "pending",
    },
    paymentMethod: {
      type: String,
      default: "cash",
      enum: ["cash", "free", "waived", "online"],
    },
    // For online payments, which provider/category the user picked
    // ("upi" | "card" | "wallet" | "razorpay" | …). Empty for cash.
    paymentProvider: {
      type: String,
      default: "",
    },
    cancellationReason: String,
    cancellationDate: Date,
    notes: String,
  },
  {
    timestamps: true,
  }
);

// Add indexes for better query performance
turfBookingSchema.index({ userId: 1 });
turfBookingSchema.index({ turfId: 1 });
turfBookingSchema.index({ status: 1 });
turfBookingSchema.index({ date: 1 });
turfBookingSchema.index({ "sport.name": 1 });

// Tenant-aware compound index for owner/club booking dashboards.
turfBookingSchema.index({ clubId: 1, status: 1, date: -1 });

// Multi-tenant scoping (Phase 1.1) — ENFORCE mode. Plugin auto-adds clubId and
// scopes club-staff reads to their tenant. Turf bookings are created by players
// (cross-tenant), so derive the tenant from the turf (turfId → Turf.clubId).
// Fall back to the turf's owner when clubId is missing (legacy turfs that
// predate the clubId backfill) so a booking is never left tenant-less.
const tenantScope = require("../utils/tenantScope");
turfBookingSchema.plugin(tenantScope, {
  field: "clubId",
  enforce: true,
  derive: async (doc) => {
    if (!doc.turfId) return null;
    const t = await mongoose
      .model("Turf")
      .findById(doc.turfId)
      .select("clubId owner")
      .lean();
    return t ? t.clubId || t.owner : null;
  },
});

module.exports = mongoose.model("TurfBooking", turfBookingSchema);
