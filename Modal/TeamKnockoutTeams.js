const mongoose = require("mongoose");

const teamKnockoutTeamsSchema = new mongoose.Schema(
  {
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
    },

    originalBookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
    },

    teamName: {
      type: String,
      required: true,
    },

    playerPositions: {
      A: { type: String, required: true }, // Captain
      B: { type: String, required: true }, // Player 1
      C: { type: String, required: false }, // Player 2 (Optional for 2-player teams)
    },

    substitutes: {
      type: [String],
      default: [],
    },

    status: {
      type: String,
      enum: ["ACTIVE", "ELIMINATED", "WITHDRAWN", "BYE_ASSIGNED"],
      default: "ACTIVE",
    },

    byeAssigned: {
      type: Boolean,
      default: false,
    },

    currentRound: {
      type: Number,
      default: 1,
    },

    matchesWon: {
      type: Number,
      default: 0,
    },

    matchesLost: {
      type: Number,
      default: 0,
    },

    setsWon: {
      type: Number,
      default: 0,
    },

    setsLost: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("TeamKnockoutTeams", teamKnockoutTeamsSchema);
