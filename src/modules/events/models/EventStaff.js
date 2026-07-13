/**
 * EventStaff — a crew member on an AgencyEvent's staff roster (Event-OS Staff Hub).
 * Roles mirror the Event-OS staff set (Manager/Coordinator/Volunteer/Referee/
 * Photographer/Commentator/Ground Staff/Security/Medical).
 */
const mongoose = require("mongoose");

const eventStaffSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: "AgencyEvent", required: true, index: true },
  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

  name: { type: String, required: true, trim: true },
  role: { type: String, default: "Volunteer" },
  shiftStart: { type: String, default: "" },
  shiftEnd: { type: String, default: "" },
  reportingManager: { type: String, default: "" },
  status: { type: String, enum: ["Active", "On Break", "Offline"], default: "Active" },
  attendance: { type: String, enum: ["Present", "Absent", "Pending"], default: "Pending" },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });

module.exports = mongoose.models.EventStaff || mongoose.model("EventStaff", eventStaffSchema);
