const mongoose = require("mongoose");

const playerStandingSchema = new mongoose.Schema(
  {
    playerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    playerName: { type: String, required: true },
    played: { type: Number, default: 0 },
    won: { type: Number, default: 0 },
    lost: { type: Number, default: 0 },
    drawn: { type: Number, default: 0 },
    // Sport-neutral scoring fields
    roundsWon: { type: Number, default: 0 },    // sets/innings/periods/frames won
    roundsLost: { type: Number, default: 0 },
    scoreFor: { type: Number, default: 0 },      // points/goals/runs scored
    scoreAgainst: { type: Number, default: 0 },   // points/goals/runs conceded
    // Cricket tiebreaker — net run rate (runs/over scored minus conceded).
    oversFor: { type: Number, default: 0 },       // overs faced (for NRR denominator)
    oversAgainst: { type: Number, default: 0 },   // overs bowled
    netRunRate: { type: Number, default: 0 },
    // Legacy aliases (backward compat — reads still work)
    setsWon: { type: Number, default: 0 },
    setsLost: { type: Number, default: 0 },
    pointsScored: { type: Number, default: 0 },
    pointsConceded: { type: Number, default: 0 },
    totalPoints: { type: Number, default: 0 },   // 3 per win, 1 per draw, 0 per loss
    rank: { type: Number, default: 0 },
    qualified: { type: Boolean, default: false },
  },
  { _id: false }
);

const groupStandingsSchema = new mongoose.Schema(
  {
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
    },
    // STEP 17f — sportId required. 1 true orphan remains (parent
    // tournament deleted; unreachable). The 10 false-orphan standings
    // were backfilled in 17f Step 1. UPDATE paths use validateModifiedOnly.
    sportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sport",
      required: true,
    },
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BookingGroup",
      required: true,
    },
    groupName: { type: String, required: true },
    scoringType: { type: String, default: null },
    standings: [playerStandingSchema],
    isFinalized: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// One standings doc per group
groupStandingsSchema.index({ tournamentId: 1, groupId: 1 }, { unique: true });
// Multi-sport scoping index. NON-UNIQUE in STEP 9a — existing docs have
// sportId: null, which would collide if marked unique. Upgrades to UNIQUE
// in STEP 16 once every doc has sportId populated by the migration script.
groupStandingsSchema.index({ tournamentId: 1, sportId: 1, groupId: 1 });

// Multi-tenant scoping (Phase 1.1) — SHADOW MODE. Plugin auto-adds clubId
// (derived via tournamentId → Tournament.clubId by the backfill).
const tenantScope = require("../utils/tenantScope");
groupStandingsSchema.plugin(tenantScope, { field: "clubId", enforce: true });

module.exports = mongoose.model("GroupStandings", groupStandingsSchema);
