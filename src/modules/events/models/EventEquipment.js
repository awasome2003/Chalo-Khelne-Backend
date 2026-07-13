/**
 * EventEquipment — an inventory line for an AgencyEvent (Event-OS Equipment Log).
 * required vs available/missing/damaged drives the STOCKED / UNDER STOCKED status.
 */
const mongoose = require("mongoose");

const eventEquipmentSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: "AgencyEvent", required: true, index: true },
  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

  name: { type: String, required: true, trim: true },
  sport: { type: String, default: "" },
  required: { type: Number, default: 0 },
  available: { type: Number, default: 0 },
  missing: { type: Number, default: 0 },
  damaged: { type: Number, default: 0 },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });

module.exports = mongoose.models.EventEquipment || mongoose.model("EventEquipment", eventEquipmentSchema);
