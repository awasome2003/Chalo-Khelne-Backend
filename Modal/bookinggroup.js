// Modal/bookinggroup.js
const mongoose = require("mongoose");

const bookingGroupSchema = new mongoose.Schema({
  tournamentId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: "Tournament",
  },
  groupName: {
    type: String,
    required: true,
  },
  category: {
    type: String,
    // required: true,
  },
  players: [
    {
      playerId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: "User",
      },
      userName: {
        type: String,
        required: true,
      },
      bookingDate: {
        type: Date,
        required: false,
        // required: true,
      },
      joinedAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  // 🎯 Group-specific match format configuration (sport-aware)
  matchFormat: {
    scoringType: {
      type: String,
      default: null,
    },
    totalSets: {
      type: Number,
      default: null, // No default — derived from sport at creation time
    },
    setsToWin: {
      type: Number,
      default: null,
    },
    totalGames: {
      type: Number,
      default: null,
    },
    gamesToWin: {
      type: Number,
      default: null,
    },
    pointsToWinGame: {
      type: Number,
      default: null,
    },
    marginToWin: {
      type: Number,
      default: null,
    },
    deuceRule: {
      type: Boolean,
      default: null,
    },
  },
  // Round tracking — 1 = initial group stage, 2 = top players round
  round: {
    type: Number,
    default: 1,
  },
  roundType: {
    type: String,
    enum: ["group_stage", "qualifier", null],
    default: "group_stage",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Changed model name from 'Group' to 'BookingGroup'
module.exports = mongoose.model("BookingGroup", bookingGroupSchema);
