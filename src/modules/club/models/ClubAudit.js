const mongoose = require("mongoose");

/**
 * ClubAudit — back-office audit trail for a facility Club (Club OS).
 * Every mutating action across club modules appends here (via logClubAudit).
 * Feeds the dashboard "Back-Office Audit Log" panel.
 */
const clubAuditSchema = new mongoose.Schema(
  {
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    user: { type: String, default: "Admin" },
    action: { type: String, required: true },
    module: { type: String, default: "" },
    details: { type: String, default: "" },
  },
  { timestamps: true }
);

clubAuditSchema.index({ clubId: 1, createdAt: -1 });

module.exports = mongoose.model("ClubAudit", clubAuditSchema);
