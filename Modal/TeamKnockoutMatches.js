const mongoose = require("mongoose");
const { getAllFormatIds } = require("../Config/teamKnockoutFormats");

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
    type: { type: String, required: true }, // "Singles A-B", "Doubles AB-AB"
    homePlayer: { type: String, default: null },
    awayPlayer: { type: String, default: null },
    homePlayerB: { type: String, default: null }, // 2nd home player (doubles)
    awayPlayerB: { type: String, default: null }, // 2nd away player (doubles)
    // Captain's doubles pairing selection (for requiresSelection sets)
    selectionId: { type: String, default: null },
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
    round: { type: Number, required: true },
    bracketPosition: { type: Number, required: true },

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

    // Config-driven format ID (e.g. "singles_bo5", "doubles_3p_bo7")
    formatId: {
      type: String,
      required: true,
      validate: {
        validator: (v) => getAllFormatIds().includes(v),
        message: (props) => `"${props.value}" is not a valid format ID`,
      },
    },

    // Legacy format string (kept for backward compat, auto-set from formatId)
    format: { type: String, default: null },

    isBye: { type: Boolean, default: false },
    matchDate: { type: Date, required: true },
    courtNumber: { type: String, default: "TBD" },

    liveState: {
      currentSetNumber: { type: Number, default: 1 },
      currentGameNumber: { type: Number, default: 1 },
      currentPoints: {
        home: { type: Number, default: 0 },
        away: { type: Number, default: 0 },
      },
      lastUpdated: { type: Date, default: Date.now },
    },

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

    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("TeamKnockoutMatches", teamKnockoutMatchesSchema);
