const mongoose = require("mongoose");

// A one-off exception to a recurring TrainingSchedule slot for a SPECIFIC date.
// Reassigning a coach is a permanent edit on the slot itself (not an override);
// overrides only capture Cancel / Postpone of a single dated occurrence.
const sessionOverrideSchema = new mongoose.Schema(
  {
    clubId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // school / organization admin (ClubAdmin / corporate_admin)
      required: true,
      index: true,
    },
    scheduleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TrainingSchedule",
      required: true,
      index: true,
    },
    date: { type: String, required: true, trim: true }, // "YYYY-MM-DD" of the occurrence
    status: {
      type: String,
      enum: ["cancelled", "postponed"],
      required: true,
    },
    // For "postponed": where it moved to.
    newDay: { type: String, default: "", trim: true },
    newStartTime: { type: String, default: "", trim: true },
    newEndTime: { type: String, default: "", trim: true },
    reason: { type: String, default: "", trim: true }, // coach_leave, ground_unavailable, weather…
    note: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

// One override per (slot, date).
sessionOverrideSchema.index({ clubId: 1, scheduleId: 1, date: 1 }, { unique: true });

const tenantScope = require("../../../../utils/tenantScope");
sessionOverrideSchema.plugin(tenantScope, { field: "clubId", enforce: true });

module.exports = mongoose.model("SessionOverride", sessionOverrideSchema);
