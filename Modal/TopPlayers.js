const mongoose = require('mongoose');

const topPlayersSchema = new mongoose.Schema({
  tournamentId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  groupId: {
    type: String, // Changed from ObjectId to String to support virtual group IDs
    required: true
  },
  groupName: {
    type: String,
    required: true
  },
  topPlayers: [{
    playerId: String,
    userName: String,
    playerName: String,
    points: { type: Number, default: 0 },
    setsWon: { type: Number, default: 0 },
    setsLost: { type: Number, default: 0 },
    won: { type: Number, default: 0 },
    lost: { type: Number, default: 0 },
    played: { type: Number, default: 0 },
    category: String,
    status: String,
    sourceRound: { type: Number, default: 1 }
  }],
  players: [{ // Added for compatibility with controller referencing group.players
    playerId: String,
    playerName: String,
    userName: String,
    category: String,
    points: { type: Number, default: 0 }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('TopPlayers', topPlayersSchema);