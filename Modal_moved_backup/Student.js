const mongoose = require("mongoose");

// A student belonging to a school / organization, organised by standard (class).
// Uploaded by the admin (Excel, standard-wise). Trainers read the roster for a
// standard when marking attendance.
const studentSchema = new mongoose.Schema(
  {
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    standard: { type: String, required: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    rollNo: { type: String, default: "", trim: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

studentSchema.index({ clubId: 1, standard: 1, order: 1 });

// ── Multi-tenant scoping (Phase 1) ─ ENFORCED ─────────────────────────
// clubId (ref User), required since creation → existing docs already populated.
// Run scripts/verifyTenancyCoverage.js (expect 100%) before deploying.
const tenantScope = require("../utils/tenantScope");
studentSchema.plugin(tenantScope, { field: "clubId", enforce: true });

module.exports = mongoose.model("Student", studentSchema);
