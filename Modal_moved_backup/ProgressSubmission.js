const mongoose = require("mongoose");

// A frozen "session report" — when a coach submits, the current per-student
// ratings for a (sport, standard) are snapshotted into history. This is the
// header; the individual frozen rows live in ProgressHistory. Read-only.
const progressSubmissionSchema = new mongoose.Schema(
  {
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sport: { type: String, required: true, trim: true },
    standard: { type: String, required: true, trim: true },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Manager", default: null },
    submittedByName: { type: String, default: "" },
    sessionDate: { type: String, default: "" }, // YYYY-MM-DD (optional, coach-set)
    studentsCount: { type: Number, default: 0 },
    topicsCount: { type: Number, default: 0 },
    average: { type: Number, default: 0 }, // overall avg of the snapshot
  },
  { timestamps: true }
);

progressSubmissionSchema.index({ clubId: 1, sport: 1, standard: 1, createdAt: -1 });

// ── Multi-tenant scoping (Phase 1) ─ ENFORCED ─────────────────────────
// clubId (ref User), required since creation → existing docs already populated.
// Run scripts/verifyTenancyCoverage.js (expect 100%) before deploying.
const tenantScope = require("../utils/tenantScope");
progressSubmissionSchema.plugin(tenantScope, { field: "clubId", enforce: true });

module.exports = mongoose.model("ProgressSubmission", progressSubmissionSchema);
