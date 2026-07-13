const mongoose = require("mongoose");

// A coach requests a change to a specific dated session (postpone / cancel /
// reschedule) with a reason. The school admin approves (which applies a
// SessionOverride or a coach reassignment) or rejects it.
const sessionChangeRequestSchema = new mongoose.Schema(
  {
    clubId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    scheduleId: { type: mongoose.Schema.Types.ObjectId, ref: "TrainingSchedule", required: true },
    coach: { type: mongoose.Schema.Types.ObjectId, ref: "Manager", default: null },
    coachName: { type: String, default: "", trim: true },
    date: { type: String, required: true, trim: true }, // "YYYY-MM-DD" of the occurrence
    requestType: { type: String, enum: ["postpone", "cancel", "reschedule"], required: true },
    reason: {
      type: String,
      enum: ["coach_leave", "ground_unavailable", "weather", "tournament", "exam", ""],
      default: "",
    },
    proposedNewDay: { type: String, default: "", trim: true },
    proposedNewStartTime: { type: String, default: "", trim: true },
    proposedNewEndTime: { type: String, default: "", trim: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    adminNote: { type: String, default: "", trim: true },
    // Snapshots for display (so the list doesn't depend on populate).
    sport: { type: String, default: "", trim: true },
    standard: { type: String, default: "", trim: true },
    section: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

sessionChangeRequestSchema.index({ clubId: 1, status: 1, createdAt: -1 });

const tenantScope = require("../../../../utils/tenantScope");
sessionChangeRequestSchema.plugin(tenantScope, { field: "clubId", enforce: true });

module.exports = mongoose.model("SessionChangeRequest", sessionChangeRequestSchema);
