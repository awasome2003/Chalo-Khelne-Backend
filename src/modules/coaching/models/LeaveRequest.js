const mongoose = require("mongoose");

// A coach applies for leave (a date range + reason). The school admin approves
// or rejects it. The coach does NOT pick a substitute (school flow); on approval
// the admin reassigns coaches on affected sessions via the schedule.
const leaveRequestSchema = new mongoose.Schema(
  {
    clubId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // school / organization admin tenant
      required: true,
      index: true,
    },
    coach: { type: mongoose.Schema.Types.ObjectId, ref: "Manager", required: true },
    coachName: { type: String, default: "", trim: true }, // snapshot
    fromDate: { type: String, required: true, trim: true }, // "YYYY-MM-DD"
    toDate: { type: String, required: true, trim: true }, // "YYYY-MM-DD"
    reason: { type: String, default: "", trim: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    adminNote: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

leaveRequestSchema.index({ clubId: 1, status: 1, createdAt: -1 });

const tenantScope = require("../../../../utils/tenantScope");
leaveRequestSchema.plugin(tenantScope, { field: "clubId", enforce: true });

module.exports = mongoose.model("LeaveRequest", leaveRequestSchema);
