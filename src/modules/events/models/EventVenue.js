/**
 * EventVenue — a court / table / field station on an AgencyEvent (Event-OS
 * Venue Manager). Tracks live operational state per station.
 */
const mongoose = require("mongoose");

const eventVenueSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: "AgencyEvent", required: true, index: true },
  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

  name: { type: String, required: true, trim: true },      // "Table 1", "Court A", "Ground 1"
  sport: { type: String, default: "" },
  status: { type: String, enum: ["Active", "Ready", "Delayed", "Available"], default: "Available" },
  currentMatch: { type: String, default: "" },             // "S. Mehta vs A. Roy"
  liveStream: { type: Boolean, default: false },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });

module.exports = mongoose.models.EventVenue || mongoose.model("EventVenue", eventVenueSchema);
