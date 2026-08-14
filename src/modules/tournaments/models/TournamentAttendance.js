const mongoose = require("mongoose");
const tenantScope = require("../../../../utils/tenantScope");

/**
 * Tournament-day attendance ("who actually turned up").
 *
 * WHY THIS EXISTS
 * ---------------
 * Local tournaments in India routinely have 53 registrations and 16–25 players
 * on the day. The draw has to be built from who is PRESENT, not from who
 * registered — but nothing in the platform recorded presence, so the manager
 * hand-ticked players on the generation screen every time, in React state that
 * did not survive a refresh, with no record of who was marked absent and no way
 * to admit a walk-in who paid cash at the desk (that screen filtered on
 * `status === "confirmed"`, i.e. on PAYMENT rather than presence).
 *
 * GRAIN
 * -----
 * One row per (tournament, sport, category, booking). Not per player: a single
 * registration can enter Men's Singles, Men's Doubles and Mixed Doubles, and a
 * player who turns up may play only some of them. Attendance is a property of
 * an ENTRY, not of a person.
 *
 * ABSENCE OF A ROW
 * ----------------
 * No row means "registered, not yet marked". Only an explicit decision is
 * stored, so "nobody has started check-in yet" is distinguishable from
 * "everyone was marked absent" — the draw screens rely on that difference to
 * decide whether to default to the checked-in list.
 *
 * PAYMENT IS DELIBERATELY NOT A GATE
 * ----------------------------------
 * A player standing in front of you with cash is present. Payment status is
 * surfaced next to them so it can be collected, but it never blocks check-in or
 * the draw.
 */
const tournamentAttendanceSchema = new mongoose.Schema(
  {
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },

    // The (sport, category) entry this attendance decision applies to.
    sportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sport",
      required: true,
    },
    categoryName: {
      type: String,
      required: true,
      trim: true,
    },

    // The registration. Always present — a walk-in gets a Booking created for
    // them first, so there is exactly one way in.
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      index: true,
    },

    // Denormalised so the roster renders without a join, and so the record
    // still reads correctly if the booking is later edited.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null, // guest / bulk-uploaded registrations have no account
    },
    userName: {
      type: String,
      required: true,
      trim: true,
    },

    status: {
      type: String,
      enum: ["checked_in", "no_show", "withdrawn"],
      required: true,
    },

    // How the decision was made. Kept because a self check-in is weaker
    // evidence than a desk operator marking someone present, and a manager
    // may want to see which is which.
    markedVia: {
      type: String,
      enum: ["manager_web", "player_mobile", "bulk_import", "walk_in"],
      default: "manager_web",
    },

    markedAt: { type: Date, default: Date.now },

    // Who made the call. Null for a player self check-in (userId is the actor).
    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    note: { type: String, default: null, trim: true, maxlength: 300 },
  },
  {
    timestamps: true,
    // Money-adjacent and audit-bearing: an undeclared field must fail loudly
    // rather than vanish (§2.6).
    strict: "throw",
  }
);

// One decision per entry. Re-marking updates in place (upsert), so toggling
// present→absent→present leaves one row with a fresh markedAt, not three.
tournamentAttendanceSchema.index(
  { tournamentId: 1, sportId: 1, categoryName: 1, bookingId: 1 },
  { unique: true }
);

// The roster query: everyone for this tournament + sport + category.
tournamentAttendanceSchema.index({ tournamentId: 1, sportId: 1, categoryName: 1, status: 1 });

// "Am I checked in?" from the mobile app.
tournamentAttendanceSchema.index({ tournamentId: 1, userId: 1 });

// Multi-tenant scoping — derives the owning club from the tournament, exactly
// like Booking does, because a player checking themselves in carries no tenant
// context of their own.
tournamentAttendanceSchema.plugin(tenantScope, {
  field: "clubId",
  enforce: true,
  derive: async (doc) => {
    if (!doc || !doc.tournamentId) return null;
    const Tournament = mongoose.model("Tournament");
    const t = await Tournament.findById(doc.tournamentId).select("clubId").lean();
    return t ? t.clubId : null;
  },
});

module.exports = mongoose.model("TournamentAttendance", tournamentAttendanceSchema);
