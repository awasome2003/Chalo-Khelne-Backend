const mongoose = require("mongoose");

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
      "round-of-32",
      "round-of-16",
      "round-of-8",
      "quarter-final",
      "semi-final",
      "final"
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
      enum: [3, 5, 7],
      comment: "Maximum sets in match (3=best of 3, 5=best of 5, 7=best of 7)"
    },

    // Game Configuration
    gamesToWin: {
      type: Number,
      default: 3,
      min: 1,
      max: 10,
      comment: "Number of games needed to win a set (best of 5 games = 3)"
    },
    maxGames: {
      type: Number,
      default: 5,
      enum: [3, 5, 7],
      comment: "Maximum games per set"
    },

    // Points Configuration
    pointsToWinGame: {
      type: Number,
      default: 11,
      min: 1,
      comment: "Points to win a game (table tennis standard: 11)"
    },
    marginToWin: {
      type: Number,
      default: 2,
      min: 1,
      comment: "Minimum point margin to win (deuce rule)"
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

  // Match Result
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

// Indexes for better query performance
DirectKnockoutMatchSchema.index({ tournamentId: 1, round: 1, matchNumber: 1 });
DirectKnockoutMatchSchema.index({ tournamentId: 1, status: 1 });
DirectKnockoutMatchSchema.index({ matchId: 1 });
DirectKnockoutMatchSchema.index({ tournamentId: 1, mode: 1 });

module.exports = mongoose.model("DirectKnockoutMatch", DirectKnockoutMatchSchema);