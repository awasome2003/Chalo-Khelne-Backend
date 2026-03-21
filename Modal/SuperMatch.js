const mongoose = require("mongoose");

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
    enum: ["pre-quarter", "quarter-final", "semi-final", "final"],
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
    type: Number,
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

  // Match Status (UPPERCASE — consistent with all other match schemas)
  status: {
    type: String,
    enum: ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
    default: "SCHEDULED"
  },

  // Match Result
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

// Indexes for better query performance
SuperMatchSchema.index({ tournamentId: 1, round: 1, matchNumber: 1 });
SuperMatchSchema.index({ tournamentId: 1, status: 1 });
SuperMatchSchema.index({ matchId: 1 });

module.exports = mongoose.model("SuperMatch", SuperMatchSchema);