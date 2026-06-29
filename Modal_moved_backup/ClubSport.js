const mongoose = require("mongoose");

// A sport offered by a school / organization, with the trainers assigned to it.
// Multiple trainers per sport; a slot with trainer=null is an undecided slot
// (e.g. "Not decided" when fewer trainers than planned).
const clubSportSchema = new mongoose.Schema(
  {
    clubId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // the ClubAdmin / corporate_admin user (school/org owner)
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true }, // sport name
    trainers: [
      {
        trainer: { type: mongoose.Schema.Types.ObjectId, ref: "Manager", default: null },
        name: { type: String, default: "" }, // snapshot of trainer name, or "Not decided"
        _id: false,
      },
    ],
  },
  { timestamps: true }
);

// One entry per sport per club.
clubSportSchema.index({ clubId: 1, name: 1 }, { unique: true });

// ── Multi-tenant scoping (Phase 1) ─ ENFORCED ─────────────────────────
// clubId (ref User), required since creation → existing docs already populated.
// Run scripts/verifyTenancyCoverage.js (expect 100%) before deploying.
const tenantScope = require("../utils/tenantScope");
clubSportSchema.plugin(tenantScope, { field: "clubId", enforce: true });

module.exports = mongoose.model("ClubSport", clubSportSchema);
