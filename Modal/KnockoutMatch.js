const mongoose = require("mongoose");

const knockoutMatchSchema = new mongoose.Schema({
  tournamentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tournament",
    required: true,
  },
  matchType: {
    type: String,
    enum: ["qualifier_knockout", "main_knockout"],
    required: true,
    comment: "Round 2 = qualifier_knockout, Round 3+ = main_knockout"
  },
  round: {
    type: Number,
    required: true,
    comment: "Round 2 = Qualifier, Round 3 = Main Knockout, Round 4 = Quarterfinals, etc."
  },
  roundName: {
    type: String,
    enum: ["Qualifier", "Main Knockout", "Round of 16", "Quarterfinals", "Semifinals", "Final"],
    required: true
  },
  bracketPosition: {
    type: Number,
    required: true,
    comment: "Position in the bracket for this round"
  },
  player1: {
    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    playerName: { type: String, required: true },
    playerType: {
      type: String,
      enum: ["general", "seeded", "super"],
      required: true
    },
    seedRank: { type: Number, default: null },
    fromGroup: { type: String, default: null, comment: "Group name if player came from group stage" }
  },
  player2: {
    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    playerName: { type: String, required: true },
    playerType: {
      type: String,
      enum: ["general", "seeded", "super"],
      required: true
    },
    seedRank: { type: Number, default: null },
    fromGroup: { type: String, default: null, comment: "Group name if player came from group stage" }
  },
  category: {
    type: String,
    required: true
  },

  // Match Status and Results
  status: {
    type: String,
    enum: ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "BYE", "WALKOVER"],
    default: "SCHEDULED"
  },
  isBye: {
    type: Boolean,
    default: false
  },
  winner: {
    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    playerName: { type: String, default: null },
    playerType: {
      type: String,
      enum: ["general", "seeded", "super"],
      default: null
    }
  },

  // Scheduling
  scheduledDate: {
    type: Date,
    required: true
  },
  scheduledTime: {
    startTime: String,
    endTime: String
  },
  court: {
    courtNumber: String,
    turfId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Turf"
    }
  },

  // Match Format
  matchFormat: {
    setsToWin: { type: Number, default: 2, comment: "Best of 3 sets" },
    pointsPerSet: { type: Number, default: 11 }
  },

  // Referee Assignment
  referee: {
    refereeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    refereeName: { type: String, default: null }
  },

  // Next Round Progression
  nextMatch: {
    matchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "KnockoutMatch",
      default: null
    },
    position: {
      type: String,
      enum: ["player1", "player2"],
      default: null,
      comment: "Which position the winner takes in the next match"
    }
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

// Indexes for performance
knockoutMatchSchema.index({ tournamentId: 1, round: 1 });
knockoutMatchSchema.index({ tournamentId: 1, matchType: 1 });
knockoutMatchSchema.index({ tournamentId: 1, category: 1 });
knockoutMatchSchema.index({ "player1.playerId": 1 });
knockoutMatchSchema.index({ "player2.playerId": 1 });

module.exports = mongoose.model("KnockoutMatch", knockoutMatchSchema);