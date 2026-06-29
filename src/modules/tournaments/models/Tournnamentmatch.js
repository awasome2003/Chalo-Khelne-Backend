/**
 * GroupStageMatch (historically "Tournnamentmatch" — filename preserved for backward compat).
 *
 * CONSOLIDATION NOTE: This is the canonical schema for group stage matches.
 * All match creation MUST go through MatchFactory.createGroupStageMatch().
 * All score reads MUST go through readMatchResult(match).
 *
 * Required fields for multi-sport: scoringType, matchResult, matchFormat
 */
const mongoose = require("mongoose");
const { addFactoryEnforcement } = require("./shared/BaseMatchFields");
const { scoringDetailFields } = require("./shared/scoringDetailFields");

const matchSchema = new mongoose.Schema({
  tournamentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tournament",
    required: true,
  },
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Group",
    required: true,
  },
  matchNumber: { type: String, required: true },
  // "singles" or "doubles" — defaults to singles for backward compatibility
  matchType: {
    type: String,
    enum: ["singles", "doubles"],
    default: "singles",
  },
  player1: {
    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      required: true,
    },
    userName: { type: String, required: true },
    // Doubles partner (only used when matchType is "doubles")
    partner: {
      playerId: { type: mongoose.Schema.Types.ObjectId, ref: "Player", default: null },
      userName: { type: String, default: null },
    },
    // Team sports (Cricket): playerId stays the canonical "side identity"
    // (so standings/advancement keep working), while teamId + squad carry the
    // team detail. Additive/optional — singles & doubles ignore these.
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: "TeamKnockoutTeams", default: null },
    squad: [{
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      name: { type: String, default: null },
      battingOrder: { type: Number, default: null },
      _id: false,
    }],
  },
  player2: {
    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      required: true,
    },
    userName: { type: String, required: true },
    // Doubles partner (only used when matchType is "doubles")
    partner: {
      playerId: { type: mongoose.Schema.Types.ObjectId, ref: "Player", default: null },
      userName: { type: String, default: null },
    },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: "TeamKnockoutTeams", default: null },
    squad: [{
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      name: { type: String, default: null },
      battingOrder: { type: Number, default: null },
      _id: false,
    }],
  },
  referee: {
    refereeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Referee"
    },
    name: String,
    contact: String
  },
  courtNumber: { type: String, required: true },
  startTime: { type: Date, required: true },
  matchEndTime: { type: Date, default: null },

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
      comment: "Maximum sets in match (1=single game, 3=best of 3, 5=best of 5, 7=best of 7)"
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

    // Innings-based sports (Cricket)
    oversCount: { type: Number, default: null },
    inningsCount: { type: Number, default: null },
    superOver: { type: Boolean, default: null },

    // Board-based sports (Carrom)
    boardsToWin: { type: Number, default: null },
    pointsPerBoard: { type: Number, default: null },
    queenValue: { type: Number, default: null }
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

  // Sets and Games Tracking
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

  // STEP 17f — sportId is now required. Boundary validators (16d) and
  // factory `_stamp` ensure every match created post-16d has sportId.
  // ~78 orphan matches (parent tournament deleted) carry null sportId
  // but are unreachable via API. UPDATE saves on existing docs use
  // `validateModifiedOnly: true` (17f retrofit) so the orphans remain
  // edit-safe via paths that don't touch sportId.
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
    ...scoringDetailFields,
  }
}, {
  timestamps: true
});

// Runtime enforcement: blocks direct instantiation (must use MatchFactory)
addFactoryEnforcement(matchSchema);

// Multi-sport scoping index. Non-unique — STEP 9a additive.
matchSchema.index({ tournamentId: 1, sportId: 1 });

// Multi-tenant scoping (Phase 1.1) — SHADOW MODE. Plugin auto-adds clubId
// (derived via tournamentId → Tournament.clubId by the backfill).
const tenantScope = require("../../../../utils/tenantScope");
matchSchema.plugin(tenantScope, { field: "clubId", enforce: true });

const Match = mongoose.model("Match", matchSchema);

module.exports = Match;
