const mongoose = require("mongoose");

/**
 * EventSponsor — a corporate sponsor registered against an event (Event OS).
 * Agency + event scoped, same pattern as the other per-event sub-resources.
 */
const TIERS = ["Title Sponsor", "Presenting Sponsor", "Gold", "Silver", "Bronze", "Associate", "Partner"];

const eventSponsorSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "AgencyEvent", required: true, index: true },
    agencyId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    brand: { type: String, required: true, trim: true },
    partnerType: { type: String, trim: true, default: "" }, // e.g. "Beverage Partner"
    tier: { type: String, enum: TIERS, default: "Partner" },
    amount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ["Paid", "Pending"], default: "Pending" },
    standeesPosition: { type: String, trim: true, default: "" },
    ledRotatingAds: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

eventSponsorSchema.index({ eventId: 1, createdAt: 1 });

module.exports = mongoose.model("EventSponsor", eventSponsorSchema);
module.exports.TIERS = TIERS;
