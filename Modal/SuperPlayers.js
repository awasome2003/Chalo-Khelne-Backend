// models/SuperPlayers.js
const mongoose = require("mongoose");

const SuperPlayersSchema = new mongoose.Schema({
  tournamentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tournament",
    required: true
  },
  round: { type: Number, default: 2 }, // Always round 2
  roundType: { type: String, default: "super_players" },
  players: [
    {
      playerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
      playerName: String,
      category: { type: String, default: "Open" },
      points: Number,
      setsWon: Number,
      setsLost: Number,
      won: Number,
      lost: Number,
      played: Number,
      status: { type: String, default: "super_player" },
      sourceRound: Number,
      sourceGroupId: String
    }
  ]
}, { timestamps: true });

module.exports = mongoose.model("SuperPlayers", SuperPlayersSchema);
