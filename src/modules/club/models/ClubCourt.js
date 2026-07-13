const mongoose = require("mongoose");

/**
 * ClubCourt — a bookable court/field in a facility-business Club (Club OS).
 * Tenant-scoped by clubId (= the club_admin User._id), mirroring the Event OS
 * sub-resource pattern. Distinct from the marketplace `Turf` (approval-gated,
 * multi-sport, player-facing); a court is an internal facility resource.
 */
const clubCourtSchema = new mongoose.Schema(
  {
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true },
    sport: { type: String, required: true, trim: true },
    surfaceType: { type: String, trim: true, default: "" },
    isIndoor: { type: Boolean, default: true },
    capacity: { type: Number, default: 0, min: 0 },
    pricePerHour: { type: Number, default: 0, min: 0 },
    peakHourPrice: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ["Available", "Occupied", "Maintenance"], default: "Available" },
    operatingHours: { type: String, default: "06:00 - 22:00" },
    maintenanceReason: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

clubCourtSchema.index({ clubId: 1, createdAt: 1 });

module.exports = mongoose.model("ClubCourt", clubCourtSchema);
