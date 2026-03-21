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
  // 🎯 Group-specific match format configuration
  matchFormat: {
    totalSets: {
      type: Number,
      default: 5
    },
    setsToWin: {
      type: Number,
      default: 3
    },
    totalGames: {
      type: Number,
      default: 5
    },
    gamesToWin: {
      type: Number,
      default: 3
    },
    pointsToWinGame: {
      type: Number,
      default: 11
    },
    marginToWin: {
      type: Number,
      default: 2
    },
    deuceRule: {
      type: Boolean,
      default: true
    }
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Changed model name from 'Group' to 'BookingGroup'
module.exports = mongoose.model("BookingGroup", bookingGroupSchema);
