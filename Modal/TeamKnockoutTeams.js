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

    // Legacy positions (A/B/C) — kept for backward compatibility with TT team formats
    playerPositions: {
      A: { type: String, required: true }, // Captain
      B: { type: String, required: true }, // Player 1
      C: { type: String, required: false }, // Player 2 (Optional for 2-player teams)
    },

    // Multi-sport roster — flexible player list for any sport (Cricket: 11, Football: 11+, etc.)
    roster: [{
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      name: { type: String, required: true },
      role: { type: String, enum: ["captain", "player", "substitute"], default: "player" },
      position: { type: String, default: null }, // Sport-specific: "bowler", "goalkeeper", etc.
      _id: false,
    }],

    teamSize: { type: Number, default: null }, // Expected team size for this sport

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
