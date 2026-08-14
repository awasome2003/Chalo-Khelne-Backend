/**
 * DirectKnockoutMatch — Standalone and post-group knockout matches.
 *
 * All match creation MUST go through MatchFactory.createKnockoutMatch().
 * All score reads MUST go through readMatchResult(match).
 *
 * Required fields for multi-sport: scoringType, matchResult, matchFormat
 */
const mongoose = require("mongoose");
const { addFactoryEnforcement } = require("./shared/BaseMatchFields");

const DirectKnockoutMatchSchema = new mongoose.Schema({
  // Tournament Context
  tournamentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tournament",
    required: true
  },

  // Direct Knockout Identification
  mode: {
    type: String,
    default: "direct-knockout",
    enum: ["direct-knockout"]
  },

  // Match Details
  matchId: {
    type: String,
    required: true,
    unique: true
  },

  // Bracket Structure - Enhanced for flexibility
  round: {
    type: String,
    enum: [
      "round-of-128",
      "round-of-64",
      "round-of-32",
      "round-of-16",
      "round-of-8",
      "round-of-4",
      "quarter-final",
      "semi-final",
      "final",
      // Optional 3rd-place play-off between the two semi-final losers. Created
      // on demand after both semis finish, never during bracket generation.
      // Terminal: it has no nextMatchId, so nothing progresses out of it.
      "third-place"
    ],
    required: true
  },

  roundNumber: {
    type: Number,
    required: true
    // 1 for first round, 2 for quarter, 3 for semi, 4 for final
  },

  matchNumber: {
    type: Number,
    required: true // Match number within the round
  },

  // Players - Progressive assignment like SuperMatch! 🔥
  player1: {
    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false // 🚀 PROGRESSIVE ASSIGNMENT!
    },
    playerName: {
      type: String,
      required: true
    }
  },

  player2: {
    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false // 🚀 PROGRESSIVE ASSIGNMENT!
    },
    playerName: {
      type: String,
      required: true
    }
  },

  // Match Scheduling
  courtNumber: {
    type: String,
    required: true
  },

  matchStartTime: {
    type: Date,
    required: true
  },

  matchEndTime: {
    type: Date,
    default: null,
  },

  estimatedDuration: {
    type: Number,
    default: 45 // minutes
  },

  // Match Format Configuration (DYNAMIC like SuperMatch! 🔥)
  matchFormat: {
    // Set Configuration
    setsToWin: {
      type: Number,
      default: 3,
      min: 1,
      max: 10,
      comment: "Number of sets needed to win match (calculated from totalSets)"
    },
    maxSets: {
      type: Number,
      default: 5,
      enum: [1, 2, 3, 5, 7],
      comment: "Maximum sets in match (3=best of 3, 5=best of 5, 7=best of 7)"
    },

    // Game Configuration (nullable for flat-set sports — TT, Badminton, Volleyball)
    // Nested-game sports (Tennis) use positive integers; flat-set sports store null
    // to explicitly signal "no games layer between set and points".
    gamesToWin: {
      type: Number,
      default: 3,
      validate: {
        validator: function (v) {
          if (v == null) return true; // null = flat-set sport, no games layer
          return Number.isInteger(v) && v >= 1 && v <= 10;
        },
        message: "gamesToWin must be an integer 1\u201310, or null for flat-set sports"
      },
      comment: "Games needed to win a set (Tennis). Null for flat-set sports (TT, Badminton)."
    },
    maxGames: {
      type: Number,
      default: 5,
      validate: {
        validator: function (v) {
          if (v == null) return true; // null = flat-set sport
          return [1, 2, 3, 5, 7].includes(v);
        },
        message: "maxGames must be 1, 2, 3, 5, 7, or null for flat-set sports"
      },
      comment: "Maximum games per set (Tennis). Null for flat-set sports."
    },

    // Points Configuration — no sport-specific defaults
    pointsToWinGame: {
      type: Number,
      default: null,
      min: 1,
      comment: "Points to win a game (set by tournament config, not hardcoded)"
    },
    marginToWin: {
      type: Number,
      default: null,
      min: 1,
      comment: "Minimum point margin to win (set by tournament config)"
    },

    // Rules Configuration
    deuceRule: {
      type: Boolean,
      default: true,
      comment: "Enable deuce rule (must win by margin)"
    },
    maxPointsPerGame: {
      type: Number,
      default: null,
      comment: "Max points per game (null=unlimited for deuce)"
    },

    // Service Rules
    serviceRule: {
      pointsPerService: { type: Number, default: 2 },
      deuceServicePoints: { type: Number, default: 1 }
    },

    // Multi-sport fields the factory freezes onto every match (totalSets,
    // scoringType, board/innings/time config). Undeclared paths are dropped
    // silently by Mongoose, so without these the computed format was written
    // and immediately lost. See shared/matchFormatFields.js.
    ...require("./shared/matchFormatFields").multiSportFormatFields,
  },

  // Live Match State
  status: {
    type: String,
    enum: ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
    default: "SCHEDULED"
  },

  // Current Game State
  currentSet: { type: Number, default: 1 },
  currentGame: { type: Number, default: 1 },

  // Live Scores
  liveScore: {
    player1Points: { type: Number, default: 0 },
    player2Points: { type: Number, default: 0 }
  },

  // Sets and Games Tracking (same as regular Match)
  sets: [{
    setNumber: { type: Number, required: true },
    status: {
      type: String,
      enum: ["IN_PROGRESS", "COMPLETED"],
      default: "IN_PROGRESS"
    },
    winner: {
      playerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null
      },
      playerName: { type: String, default: null }
    },
    games: [{
      gameNumber: { type: Number, required: true },
      status: {
        type: String,
        enum: ["IN_PROGRESS", "COMPLETED"],
        default: "IN_PROGRESS"
      },
      finalScore: {
        player1: { type: Number, default: 0 },
        player2: { type: Number, default: 0 }
      },
      winner: {
        playerId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null
        },
        playerName: { type: String, default: null }
      },
      startTime: { type: Date, default: Date.now },
      endTime: { type: Date, default: null }
    }]
  }],

  // Sport identification
  sportName: { type: String, default: null },

  // Bracket category (e.g. "Open", "Above 40"). Null = the tournament's single
  // undifferentiated bracket for this sport (legacy + single-category events).
  // Stamped at generation so multiple category brackets can coexist under one
  // tournament+sport; generation and reset scope their deletes on it.
  category: {
    type: String,
    default: null,
  },

  // STEP 17f — sportId required. Boundary validator (16d) enforces on
  // create. Audit confirms 0 orphan DirectKnockoutMatch docs.
  sportId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Sport",
    required: true,
  },

  // Multi-sport scoring type
  scoringType: {
    type: String,
    default: null,
  },

  // Normalized multi-sport result (populated by scoring engine + migration)
  matchResult: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },

  // Match Result (legacy — kept for backward compat)
  result: {
    winner: {
      playerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null
      },
      playerName: { type: String, default: null }
    },
    finalScore: {
      player1Sets: { type: Number, default: 0 },
      player2Sets: { type: Number, default: 0 }
    },
    matchDuration: { type: Number, default: 0 }, // in minutes
    completedAt: { type: Date, default: null },

    // Cricket (innings) + Carrom (board) detail — additive, shared across models
    ...require("./shared/scoringDetailFields").scoringDetailFields,
  },

  // 🔥 BRACKET PROGRESSION - The magic sauce!
  nextMatchId: {
    type: String // ID of the next match this winner will advance to
  },

  // Bracket Position Tracking
  bracketPosition: {
    type: String,
    comment: "Position in bracket tree (e.g., 'L1', 'R1', 'L2', 'R2' for left/right sides)"
  },

  // Match Notes
  notes: String,

  // Optional Referee
  referee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }

}, {
  timestamps: true
});

// Runtime enforcement: blocks direct instantiation (must use MatchFactory)
addFactoryEnforcement(DirectKnockoutMatchSchema);

// Indexes for better query performance
DirectKnockoutMatchSchema.index({ tournamentId: 1, round: 1, matchNumber: 1 });
DirectKnockoutMatchSchema.index({ tournamentId: 1, status: 1 });
// matchId unique index comes from the field-level `unique: true` (no dup here).
DirectKnockoutMatchSchema.index({ tournamentId: 1, mode: 1 });
// Multi-sport scoping index. Non-unique — STEP 9a additive.
DirectKnockoutMatchSchema.index({ tournamentId: 1, sportId: 1 });
// Per-category bracket scoping — backs the generate/reset delete filter.
DirectKnockoutMatchSchema.index({ tournamentId: 1, sportId: 1, category: 1 });

// Multi-tenant scoping (Phase 1.1) — SHADOW MODE. Plugin auto-adds clubId
// (derived via tournamentId → Tournament.clubId by the backfill).
const tenantScope = require("../../../../utils/tenantScope");
DirectKnockoutMatchSchema.plugin(tenantScope, { field: "clubId", enforce: true });

module.exports = mongoose.model("DirectKnockoutMatch", DirectKnockoutMatchSchema);