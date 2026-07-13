/**
 * EventTask — a checklist item / task under an AgencyEvent (Event OS, Phase 1).
 * `category: "checklist"` = auto-seeded from the sport template; "task" = manual.
 */
const mongoose = require("mongoose");

const eventTaskSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: "AgencyEvent", required: true, index: true },
  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

  title: { type: String, required: true, trim: true },
  priority: { type: String, enum: ["Low", "Medium", "High"], default: "Medium" },
  status: { type: String, enum: ["To Do", "In Progress", "Completed"], default: "To Do" },
  category: { type: String, enum: ["checklist", "task"], default: "task" },
  sport: { type: String, default: "" },          // template origin, if any
  owner: { type: String, default: "" },
  deadline: { type: String, default: "" },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });

module.exports = mongoose.models.EventTask || mongoose.model("EventTask", eventTaskSchema);
