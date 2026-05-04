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
  // STEP 17f — sportId required. Boundary validator (16d) enforces on
  // create. ~39 orphans with null sportId are unreachable; UPDATE paths
  // use validateModifiedOnly so orphan edits stay safe.
  sportId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Sport",
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Multi-sport scoping index. Non-unique — STEP 9a additive.
bookingGroupSchema.index({ tournamentId: 1, sportId: 1 });

// Changed model name from 'Group' to 'BookingGroup'
module.exports = mongoose.model("BookingGroup", bookingGroupSchema);
