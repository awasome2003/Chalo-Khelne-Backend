/**
 * KnockoutMatch — Legacy knockout match schema (group-to-knockout flow).
 *
 * @deprecated FUTURE: Merge with DirectKnockoutMatch into unified schema.
 * All match creation MUST go through MatchFactory.createLegacyKnockoutMatch().
 * All score reads MUST go through readMatchResult(match).
 *
 * Required fields for multi-sport: scoringType, matchResult
 */
const mongoose = require("mongoose");
const { addFactoryEnforcement } = require("./shared/BaseMatchFields");

const knockoutMatchSchema = new mongoose.Schema({
  tournamentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tournament",
    required: true,
  },
  matchType: {
    type: String,
    enum: ["qualifier_knockout", "main_knockout"],
    required: true,
    comment: "Round 2 = qualifier_knockout, Round 3+ = main_knockout"
  },
  round: {
    type: Number,
    required: true,
    comment: "Round 2 = Qualifier, Round 3 = Main Knockout, Round 4 = Quarterfinals, etc."
  },
  roundName: {
    type: String,
    enum: ["Qualifier", "Main Knockout", "Round of 16", "Quarterfinals", "Semifinals", "Final"],
    required: true
  },
  bracketPosition: {
    type: Number,
    required: true,
    comment: "Position in the bracket for this round"
  },
  player1: {
    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    playerName: { type: String, required: true },
    playerType: {
      type: String,
      enum: ["general", "seeded", "super"],
      required: true
    },
    seedRank: { type: Number, default: null },
    fromGroup: { type: String, default: null, comment: "Group name if player came from group stage" }
  },
  player2: {
    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    playerName: { type: String, required: true },
    playerType: {
      type: String,
      enum: ["general", "seeded", "super"],
      required: true
    },
    seedRank: { type: Number, default: null },
    fromGroup: { type: String, default: null, comment: "Group name if player came from group stage" }
  },
  category: {
    type: String,
    required: true
  },

  // Match Status and Results
  status: {
    type: String,
    enum: ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "BYE", "WALKOVER"],
    default: "SCHEDULED"
  },
  isBye: {
    type: Boolean,
    default: false
  },
  winner: {
    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    playerName: { type: String, default: null },
    playerType: {
      type: String,
      enum: ["general", "seeded", "super"],
      default: null
    }
  },

  // Scheduling
  scheduledDate: {
    type: Date,
    required: true
  },
  scheduledTime: {
    startTime: String,
    endTime: String
  },
  court: {
    courtNumber: String,
    turfId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Turf"
    }
  },

  // Match Format
  matchFormat: {
    setsToWin: { type: Number, default: null, comment: "Sets needed to win (set by tournament config)" },
    pointsPerSet: { type: Number, default: null, comment: "Points per set (set by tournament config)" }
  },

  // Referee Assignment
  referee: {
    refereeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    refereeName: { type: String, default: null }
  },

  // Next Round Progression
  nextMatch: {
    matchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "KnockoutMatch",
      default: null
    },
    position: {
      type: String,
      enum: ["player1", "player2"],
      default: null,
      comment: "Which position the winner takes in the next match"
    }
  },

  // Multi-sport fields
  // Sport identification
  sportName: { type: String, default: null },

  // STEP 17f — sportId required. Collection currently empty (0 docs);
  // boundary validators ensure new creates always have it.
  sportId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Sport",
    required: true,
  },

  scoringType: {
    type: String,
    default: null,
  },
  matchResult: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

// Runtime enforcement: blocks direct instantiation (must use MatchFactory)
addFactoryEnforcement(knockoutMatchSchema);

// Indexes for performance
knockoutMatchSchema.index({ tournamentId: 1, round: 1 });
knockoutMatchSchema.index({ tournamentId: 1, matchType: 1 });
knockoutMatchSchema.index({ tournamentId: 1, category: 1 });
knockoutMatchSchema.index({ "player1.playerId": 1 });
knockoutMatchSchema.index({ "player2.playerId": 1 });
// Multi-sport scoping index. Non-unique — STEP 9a additive.
knockoutMatchSchema.index({ tournamentId: 1, sportId: 1 });

// Multi-tenant scoping (Phase 1.1) — SHADOW MODE. Plugin auto-adds clubId
// (derived via tournamentId → Tournament.clubId by the backfill).
const tenantScope = require("../utils/tenantScope");
knockoutMatchSchema.plugin(tenantScope, { field: "clubId", enforce: true });

module.exports = mongoose.model("KnockoutMatch", knockoutMatchSchema);