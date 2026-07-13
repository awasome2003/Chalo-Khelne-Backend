/**
 * EventOfficial — a referee/umpire/adjudicator on an AgencyEvent's roster.
 * Event-OS Officials Hub (Phase 2).
 */
const mongoose = require("mongoose");

const eventOfficialSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: "AgencyEvent", required: true, index: true },
  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

  name: { type: String, required: true, trim: true },
  role: { type: String, default: "Referee" },     // Referee / Umpire / Scorer / Chair Umpire…
  sport: { type: String, default: "" },
  court: { type: String, default: "" },
  shiftStart: { type: String, default: "" },       // "09:00"
  shiftEnd: { type: String, default: "" },         // "15:00"
  payout: { type: Number, default: 0 },
  attendance: { type: String, enum: ["Present", "Absent", "Pending"], default: "Pending" },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });

module.exports = mongoose.models.EventOfficial || mongoose.model("EventOfficial", eventOfficialSchema);
