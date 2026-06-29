const mongoose = require("mongoose");

// Per-student progress against a single syllabus topic, rated 1–5 stars by the
// coach who teaches that sport. One row per (student, syllabus entry) — ratings
// are upserted. sport/standard are denormalized from the syllabus entry for fast
// reporting. ratedBy is the effective trainer (the coach, even for a substitute).
const studentProgressSchema = new mongoose.Schema(
  {
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    syllabusEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "SyllabusEntry", required: true, index: true },
    sport: { type: String, required: true, trim: true },
    standard: { type: String, required: true, trim: true },
    stars: { type: Number, required: true, min: 1, max: 5 },
    remark: { type: String, default: "", trim: true },
    ratedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Manager", default: null },
  },
  { timestamps: true }
);

// One rating per student per topic.
studentProgressSchema.index({ clubId: 1, studentId: 1, syllabusEntryId: 1 }, { unique: true });

// ── Multi-tenant scoping (Phase 1) ─ ENFORCED ─────────────────────────
// clubId (ref User), required since creation → existing docs already populated.
// Run scripts/verifyTenancyCoverage.js (expect 100%) before deploying.
const tenantScope = require("../../../../utils/tenantScope");
studentProgressSchema.plugin(tenantScope, { field: "clubId", enforce: true });

module.exports = mongoose.model("StudentProgress", studentProgressSchema);
