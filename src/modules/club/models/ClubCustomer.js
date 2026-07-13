const mongoose = require("mongoose");

/**
 * ClubCustomer — a CRM profile for anyone who transacts with a facility Club
 * (Club OS). Tenant-scoped by clubId, keyed by phone within a club. Auto-created
 * / updated from bookings & memberships (upsertClubCustomer in automation.js);
 * the timeline accumulates their journey (bookings, membership, payments, notes).
 */
const timelineEventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["membership_purchased", "booking", "tournament_participation", "payment", "attendance", "coach_note"],
      default: "booking",
    },
    date: { type: String, default: "" }, // YYYY-MM-DD
    time: { type: String, default: "" },
    title: { type: String, default: "" },
    description: { type: String, default: "" },
  },
  { _id: true, timestamps: false }
);

const clubCustomerSchema = new mongoose.Schema(
  {
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: "", index: true },
    email: { type: String, default: "" },
    favoriteSports: { type: [String], default: [] },
    membershipStatus: { type: String, enum: ["Active", "Expired", "None"], default: "None" },
    lifetimeSpending: { type: Number, default: 0 },
    totalVisits: { type: Number, default: 0 },
    totalBookings: { type: Number, default: 0 },
    lastVisit: { type: String, default: "" },
    notes: { type: String, default: "" },
    timeline: { type: [timelineEventSchema], default: [] },
  },
  { timestamps: true }
);

clubCustomerSchema.index({ clubId: 1, phone: 1 });

module.exports = mongoose.model("ClubCustomer", clubCustomerSchema);
