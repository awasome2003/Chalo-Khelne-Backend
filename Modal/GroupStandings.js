const mongoose = require("mongoose");

const playerStandingSchema = new mongoose.Schema(
  {
    playerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    playerName: { type: String, required: true },
    played: { type: Number, default: 0 },
    won: { type: Number, default: 0 },
    lost: { type: Number, default: 0 },
    setsWon: { type: Number, default: 0 },
    setsLost: { type: Number, default: 0 },
    pointsScored: { type: Number, default: 0 },
    pointsConceded: { type: Number, default: 0 },
    totalPoints: { type: Number, default: 0 }, // 3 per win, 0 per loss
    rank: { type: Number, default: 0 },
    qualified: { type: Boolean, default: false },
  },
  { _id: false }
);

const groupStandingsSchema = new mongoose.Schema(
  {
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
    },
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BookingGroup",
      required: true,
    },
    groupName: { type: String, required: true },
    standings: [playerStandingSchema],
    isFinalized: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// One standings doc per group
groupStandingsSchema.index({ tournamentId: 1, groupId: 1 }, { unique: true });

module.exports = mongoose.model("GroupStandings", groupStandingsSchema);
