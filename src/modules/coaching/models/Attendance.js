const mongoose = require("mongoose");

// One attendance record per subject (the trainer themselves, or a student) for
// a session = (date, sport, standard) run by a trainer. `date` is a plain
// "YYYY-MM-DD" string to keep it timezone-stable.
const attendanceSchema = new mongoose.Schema(
  {
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    trainerId: { type: mongoose.Schema.Types.ObjectId, ref: "Manager", required: true, index: true },
    date: { type: String, required: true }, // YYYY-MM-DD
    sport: { type: String, default: "" },
    standard: { type: String, default: "" },
    subjectType: { type: String, enum: ["self", "student"], required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", default: null },
    status: { type: String, enum: ["present", "absent"], required: true },
    // Reason for absence — required when a trainer/coach marks themselves absent.
    reason: { type: String, default: "" },
  },
  { timestamps: true }
);

// One record per subject per session.
attendanceSchema.index(
  { trainerId: 1, date: 1, sport: 1, standard: 1, subjectType: 1, studentId: 1 },
  { unique: true }
);
// Hot path (Phase 5): per-student attendance history, tenant-scoped, newest first.
attendanceSchema.index({ clubId: 1, studentId: 1, date: -1 });

// ── Multi-tenant scoping (Phase 1) ─ ENFORCED ─────────────────────────
// clubId (ref User) is required since schema creation, so existing docs are
// already populated. Run scripts/verifyTenancyCoverage.js (expect 100%) before
// deploying. Club-staff reads/writes auto-scope to their clubId; players /
// public / SuperAdmin are unaffected. Revert by setting enforce:false.
const tenantScope = require("../../../../utils/tenantScope");
attendanceSchema.plugin(tenantScope, { field: "clubId", enforce: true });

module.exports = mongoose.model("Attendance", attendanceSchema);
