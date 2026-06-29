const mongoose = require("mongoose");

// One session/day in a syllabus — "in week N, this topic is taught" for a
// (sport, standard). Coaches see these as their day's plan and can mark them
// taught. Mirrors the recommended data model in SPORTS_SYLLABUS_RESEARCH.md.
const syllabusEntrySchema = new mongoose.Schema(
  {
    syllabusId: { type: mongoose.Schema.Types.ObjectId, ref: "SportsSyllabus", required: true, index: true },
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sport: { type: String, default: "" },
    standard: { type: String, default: "" },

    weekNumber: { type: Number, default: 1 },
    order: { type: Number, default: 0 },

    topic: { type: String, required: true, trim: true }, // the day's focus
    objectives: { type: String, default: "" },
    activities: { type: String, default: "" }, // drills / practice
    equipment: { type: String, default: "" },
    notes: { type: String, default: "" },

    status: { type: String, enum: ["planned", "completed"], default: "planned" },
    completedAt: { type: Date, default: null },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Manager", default: null },
  },
  { timestamps: true }
);

syllabusEntrySchema.index({ clubId: 1, sport: 1, standard: 1, weekNumber: 1, order: 1 });

// ── Multi-tenant scoping (Phase 1) ─ ENFORCED ─────────────────────────
// clubId (ref User), required since creation → existing docs already populated.
// Run scripts/verifyTenancyCoverage.js (expect 100%) before deploying.
const tenantScope = require("../../../../utils/tenantScope");
syllabusEntrySchema.plugin(tenantScope, { field: "clubId", enforce: true });

module.exports = mongoose.model("SyllabusEntry", syllabusEntrySchema);
