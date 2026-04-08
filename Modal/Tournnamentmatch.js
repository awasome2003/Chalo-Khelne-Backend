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
      enum: [3, 5, 7],
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
      enum: [3, 5, 7],
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
    completedAt: { type: Date, default: null }
  }
}, {
  timestamps: true
});

// Runtime enforcement: blocks direct instantiation (must use MatchFactory)
addFactoryEnforcement(matchSchema);

const Match = mongoose.model("Match", matchSchema);

module.exports = Match;
