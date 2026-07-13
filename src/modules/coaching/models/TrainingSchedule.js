const mongoose = require("mongoose");

// A training-schedule row set by a school / organization admin, mirroring the
// printed timetable: a Day + Standard (class) + Time slot + the Sports running
// in that slot. Trainers see the rows that include the sport(s) they train.
const trainingScheduleSchema = new mongoose.Schema(
  {
    clubId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // school / organization admin (ClubAdmin / corporate_admin user)
      required: true,
      index: true,
    },
    day: { type: String, required: true, trim: true }, // Monday, Tuesday…
    standard: { type: String, default: "", trim: true }, // "V", "IV", "IX & X"
    section: { type: String, default: "", trim: true }, // "A", "B" (from Class & Section)
    time: { type: String, default: "", trim: true }, // display "12:30 pm TO 1:30 pm" (derived)
    startTime: { type: String, default: "", trim: true }, // "16:00"
    endTime: { type: String, default: "", trim: true }, // "17:00"
    sports: { type: [String], default: [] }, // kept (mirror of `sport`) so the trainer /mine filter keeps working
    sport: { type: String, default: "", trim: true }, // single sport per slot (new primary field)
    coach: { type: mongoose.Schema.Types.ObjectId, ref: "Manager", default: null }, // assigned coach (Manager)
    coachName: { type: String, default: "", trim: true }, // snapshot so we don't depend on populate
    ground: { type: String, default: "", trim: true }, // "Field A", "Indoor Court"
    order: { type: Number, default: 0 }, // for stable ordering (Sr. No.)
  },
  { timestamps: true }
);

trainingScheduleSchema.index({ clubId: 1, order: 1 });

// ── Multi-tenant scoping (Phase 1) ─ ENFORCED ─────────────────────────
// clubId (ref User), required since creation → existing docs already populated.
// Run scripts/verifyTenancyCoverage.js (expect 100%) before deploying.
const tenantScope = require("../../../../utils/tenantScope");
trainingScheduleSchema.plugin(tenantScope, { field: "clubId", enforce: true });

module.exports = mongoose.model("TrainingSchedule", trainingScheduleSchema);
