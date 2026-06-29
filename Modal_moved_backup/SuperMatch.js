/**
 * SuperMatch — Knockout matches generated from group stage top players.
 *
 * @deprecated FUTURE: Merge into a unified KnockoutMatch schema.
 * All match creation MUST go through MatchFactory.createSuperMatch().
 * All score reads MUST go through readMatchResult(match).
 *
 * Required fields for multi-sport: scoringType, matchResult, matchFormat
 */
const mongoose = require("mongoose");
const { addFactoryEnforcement } = require("./shared/BaseMatchFields");

const SuperMatchSchema = new mongoose.Schema({
  tournamentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tournament",
    required: true
  },

  // Match Details
  matchId: {
    type: String,
    required: true,
    unique: true
  },

  round: {
    type: String,
    // Bracket builder produces "round-of-{N}" for any first round larger
    // than 8. Originally the enum only listed quarters/semis/final because
    // the production "Round-2 mini-group-stage → Super Players" path always
    // narrowed players down to ≤8 before generating SuperMatch records.
    // The "skip Round 2 → straight to knockout" shortcut feeds 16/32/64/128
    // directly, so those round names are now valid here too.
    enum: [
      "pre-quarter",     // legacy (kept for backward compat)
      "round-of-128",
      "round-of-64",
      "round-of-32",
      "round-of-16",
      "quarter-final",
      "semi-final",
      "final",
    ],
    required: true
  },

  roundNumber: {
    type: Number,
    required: true // 1 for pre-quarter, 2 for quarter, 3 for semi, 4 for final
  },

  matchNumber: {
    type: Number,
    required: true // Match number within the round
  },

  // Players
  player1: {
    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false
    },
    playerName: {
      type: String,
      required: true
    },
    seed: Number // Seeding number
  },

  player2: {
    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false
    },
    playerName: {
      type: String,
      required: true
    },
    seed: Number // Seeding number
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

  // Match Format Configuration (inherits from tournament, allows overrides)
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

    // Game Configuration
    gamesToWin: {
      type: Number,
      default: 3,
      min: 1,
      max: 10,
      comment: "Number of games needed to win set (calculated from totalGames)"
    },
    maxGames: {
      type: Number,
      default: 5,
      enum: [1, 2, 3, 5, 7],
      comment: "Maximum games per set"
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
    }
  },

  // Match Status (UPPERCASE — consistent with all other match schemas)
  status: {
    type: String,
    enum: ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
    default: "SCHEDULED"
  },

  // Sport identification
  sportName: { type: String, default: null },

  // STEP 17f — sportId required. Collection currently empty (0 docs);
  // boundary validators ensure new creates always have it.
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
  winner: {
    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    playerName: String
  },

  loser: {
    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    playerName: String
  },

  // Cricket (innings) + Carrom (board) detail. SuperMatch primarily uses
  // winner/score above, but the incremental scorers persist detail here so
  // the shape matches Match / DirectKnockoutMatch.
  result: {
    ...require("./shared/scoringDetailFields").scoringDetailFields,
  },

  // Match Score
  score: {
    player1Sets: { type: Number, default: 0 },
    player2Sets: { type: Number, default: 0 },
    setScores: [
      {
        setNumber: Number,
        player1Score: Number,
        player2Score: Number
      }
    ]
  },

  // Live Scoreboard Data (compatible with existing scoreboard system)
  sets: [
    {
      setNumber: { type: Number },
      status: { type: String, enum: ["IN_PROGRESS", "COMPLETED"], default: "IN_PROGRESS" },
      winner: {
        playerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        playerName: { type: String }
      },
      games: [
        {
          gameNumber: { type: Number },
          status: { type: String, enum: ["IN_PROGRESS", "COMPLETED"], default: "IN_PROGRESS" },
          finalScore: {
            player1: { type: Number, default: 0 },
            player2: { type: Number, default: 0 }
          },
          winner: {
            playerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
            playerName: { type: String }
          },
          startTime: { type: Date },
          endTime: { type: Date }
        }
      ]
    }
  ],

  // Current match state (for live scoring)
  currentSet: { type: Number, default: 1 },
  currentGame: { type: Number, default: 1 },
  liveScore: {
    player1Points: { type: Number, default: 0 },
    player2Points: { type: Number, default: 0 }
  },

  // Detailed Statistics for Leaderboard
  statistics: {
    player1Stats: {
      setsWon: { type: Number, default: 0 },
      setsLost: { type: Number, default: 0 },
      gamesWon: { type: Number, default: 0 },
      gamesLost: { type: Number, default: 0 },
      totalPoints: { type: Number, default: 0 }, // Cumulative points scored
      totalPointsAgainst: { type: Number, default: 0 }, // Points conceded
      matchesWon: { type: Number, default: 0 },
      matchesLost: { type: Number, default: 0 },
      matchesPlayed: { type: Number, default: 0 }
    },
    player2Stats: {
      setsWon: { type: Number, default: 0 },
      setsLost: { type: Number, default: 0 },
      gamesWon: { type: Number, default: 0 },
      gamesLost: { type: Number, default: 0 },
      totalPoints: { type: Number, default: 0 }, // Cumulative points scored
      totalPointsAgainst: { type: Number, default: 0 }, // Points conceded
      matchesWon: { type: Number, default: 0 },
      matchesLost: { type: Number, default: 0 },
      matchesPlayed: { type: Number, default: 0 }
    }
  },

  // Next Match Progression
  nextMatchId: {
    type: String // ID of the next match this winner will play
  },

  // Match Notes
  notes: String,

  // Referee/Official
  referee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }

}, {
  timestamps: true
});

// Runtime enforcement: blocks direct instantiation (must use MatchFactory)
addFactoryEnforcement(SuperMatchSchema);

// Indexes for better query performance
SuperMatchSchema.index({ tournamentId: 1, round: 1, matchNumber: 1 });
SuperMatchSchema.index({ tournamentId: 1, status: 1 });
// matchId unique index comes from the field-level `unique: true` (no dup here).
// Multi-sport scoping index. Non-unique — STEP 9a additive.
SuperMatchSchema.index({ tournamentId: 1, sportId: 1 });

// Multi-tenant scoping (Phase 1.1) — SHADOW MODE. Plugin auto-adds clubId
// (derived via tournamentId → Tournament.clubId by the backfill).
const tenantScope = require("../utils/tenantScope");
SuperMatchSchema.plugin(tenantScope, { field: "clubId", enforce: true });

module.exports = mongoose.model("SuperMatch", SuperMatchSchema);