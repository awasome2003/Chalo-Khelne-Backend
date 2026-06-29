const mongoose = require("mongoose");

// A syllabus container — one per (club, sport, standard). Holds the term/year
// metadata; the week-by-week sessions live in SyllabusEntry.
const sportsSyllabusSchema = new mongoose.Schema(
  {
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sport: { type: String, required: true, trim: true },
    standard: { type: String, default: "", trim: true },
    title: { type: String, default: "" },
    academicYear: { type: String, default: "" },
    term: { type: String, default: "" },
    description: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

sportsSyllabusSchema.index({ clubId: 1, sport: 1, standard: 1 }, { unique: true });

// ── Multi-tenant scoping (Phase 1) ─ ENFORCED ─────────────────────────
// clubId (ref User), required since creation → existing docs already populated.
// Run scripts/verifyTenancyCoverage.js (expect 100%) before deploying.
const tenantScope = require("../utils/tenantScope");
sportsSyllabusSchema.plugin(tenantScope, { field: "clubId", enforce: true });

module.exports = mongoose.model("SportsSyllabus", sportsSyllabusSchema);
