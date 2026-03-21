const mongoose = require("mongoose");

const gameSchema = new mongoose.Schema(
  {
    gameNumber: { type: Number, required: true },
    homePoints: { type: Number, default: 0 },
    awayPoints: { type: Number, default: 0 },
    winner: { type: String, enum: ["home", "away"], default: null },
    status: {
      type: String,
      enum: ["PENDING", "IN_PROGRESS", "COMPLETED"],
      default: "PENDING",
    },
    startTime: { type: Date, default: null },
    endTime: { type: Date, default: null },
  },
  { _id: false }
);

const setSchema = new mongoose.Schema(
  {
    setNumber: { type: Number, required: true },
    type: { type: String, required: true }, // "Singles A-X", "Doubles AB-XY"
    homePlayer: { type: String, required: false }, // Player name
    awayPlayer: { type: String, required: false }, // Player name
    homePlayerB: { type: String, default: null }, // For doubles
    awayPlayerZ: { type: String, default: null }, // For doubles
    status: {
      type: String,
      enum: ["PENDING", "IN_PROGRESS", "COMPLETED"],
      default: "PENDING",
    },
    games: [gameSchema],
    gamesWon: {
      home: { type: Number, default: 0 },
      away: { type: Number, default: 0 },
    },
    setWinner: { type: String, enum: ["home", "away"], default: null },
  },
  { _id: false }
);

const teamKnockoutMatchesSchema = new mongoose.Schema(
  {
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
    },

    round: {
      type: Number,
      required: true,
    },

    bracketPosition: {
      type: Number,
      required: true,
    },

    team1Id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TeamKnockoutTeams",
      required: true,
    },

    team2Id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TeamKnockoutTeams",
      default: null,
    },

    winnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TeamKnockoutTeams",
      default: null,
    },

    status: {
      type: String,
      enum: ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "BYE", "CANCELLED"],
      default: "SCHEDULED",
    },

    format: {
      type: String,
      required: true,
      enum: [
        "Singles - 3 Sets",
        "Singles - 5 Sets",
        "Doubles - 3 Sets",
        "Doubles - 5 Sets",
        "Singles - 3 Sets (2 Players)",
        "Singles - 5 Sets (2 Players)",
        "Doubles - 3 Sets (2 Players)",
        "Doubles - 5 Sets (2 Players)",
      ],
    },

    isBye: {
      type: Boolean,
      default: false,
    },

    matchDate: {
      type: Date,
      required: true,
    },

    courtNumber: {
      type: String,
      default: "TBD",
    },

    liveState: {
      currentSetNumber: { type: Number, default: 1 },
      currentGameNumber: { type: Number, default: 1 },
      currentPoints: {
        home: { type: Number, default: 0 },
        away: { type: Number, default: 0 },
      },
      lastUpdated: { type: Date, default: Date.now },
    },

    // Scoring rules per game (derived from tournament.matchFormat / sportRules)
    gameRules: {
      gamesPerSet: { type: Number, default: 3 },
      gamesToWin: { type: Number, default: 2 },
      pointsToWinGame: { type: Number, default: 11 },
      marginToWin: { type: Number, default: 2 },
      deuceRule: { type: Boolean, default: true },
      maxPointsCap: { type: Number, default: null },
    },

    sets: [setSchema],

    setsWon: {
      home: { type: Number, default: 0 },
      away: { type: Number, default: 0 },
    },

    matchWinner: {
      type: String,
      enum: ["home", "away"],
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "TeamKnockoutMatches",
  teamKnockoutMatchesSchema
);
