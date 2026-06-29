const mongoose = require("mongoose");

// One frozen rating row inside a submitted session report. Fully denormalized
// (student name, topic, week) so history reads don't depend on later edits or
// deletions of the live student/syllabus. Never updated after creation.
const progressHistorySchema = new mongoose.Schema(
  {
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    submissionId: { type: mongoose.Schema.Types.ObjectId, ref: "ProgressSubmission", required: true, index: true },
    sport: { type: String, required: true, trim: true },
    standard: { type: String, required: true, trim: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    studentName: { type: String, default: "" },
    rollNo: { type: String, default: "" },
    syllabusEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "SyllabusEntry", required: true },
    weekNumber: { type: Number, default: 0 },
    topic: { type: String, default: "" },
    stars: { type: Number, min: 1, max: 5, required: true },
    remark: { type: String, default: "" },
    submittedAt: { type: Date, required: true }, // = submission time (denormalized for sorting)
  },
  { timestamps: true }
);

progressHistorySchema.index({ clubId: 1, studentId: 1, syllabusEntryId: 1, submittedAt: 1 });
progressHistorySchema.index({ clubId: 1, sport: 1, standard: 1, submittedAt: -1 });

// ── Multi-tenant scoping (Phase 1) ─ ENFORCED ─────────────────────────
// clubId (ref User), required since creation → existing docs already populated.
// Run scripts/verifyTenancyCoverage.js (expect 100%) before deploying.
const tenantScope = require("../utils/tenantScope");
progressHistorySchema.plugin(tenantScope, { field: "clubId", enforce: true });

module.exports = mongoose.model("ProgressHistory", progressHistorySchema);
