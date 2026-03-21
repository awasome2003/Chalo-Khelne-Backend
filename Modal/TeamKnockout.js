const mongoose = require("mongoose");

const teamKnockoutSchema = new mongoose.Schema({
  tournamentId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  round: {
    type: Number,
    required: true,
  },
  totalRounds: {
    type: Number,
    required: true,
  },
  bracketPosition: {
    type: Number,
    required: true,
  },
  team1: {
    _id: mongoose.Schema.Types.ObjectId,
    name: String,
    position: String,
    captain: String,
    players: [String],
    substitutes: [String],
  },
  team2: {
    _id: mongoose.Schema.Types.ObjectId,
    name: String,
    position: String,
    captain: String,
    players: [String],
    substitutes: [String],
  },
  format: String,
  matches: Array,
  isBye: {
    type: Boolean,
    default: false,
  },
  isPending: {
    type: Boolean,
    default: false,
  },
  status: {
    type: String,
    default: "SCHEDULED",
  },
  winningTeam: {
    type: {
      _id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Team",
      },
      name: String,
      captain: String,
      players: [String],
    },
    default: null,
  },
  matchStartTime: {
    type: String,
    required: true,
  },
  matchInterval: {
    type: String,
    default: "0",
  },
  courtNumber: {
    type: String,
    default: "TBD",
  },
  substitutions: [
    {
      team: {
        type: String,
        required: true,
        enum: ["team1", "team2"],
      },
      outgoingPlayer: {
        type: String,
        required: true,
      },
      incomingPlayer: {
        type: String,
        required: true,
      },
      gameOrder: {
        type: Number,
        required: true,
      },
      position: {
        type: String,
        required: true,
      },
      timestamp: {
        type: Date,
        default: Date.now,
      },
    },
  ],
});

module.exports = mongoose.model("TeamKnockout", teamKnockoutSchema);
