const mongoose = require('mongoose');

const topPlayersSchema = new mongoose.Schema({
  tournamentId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  // STEP 17f — sportId required. 1 orphan with null sportId
  // (parent tournament deleted) is unreachable; UPDATE paths use
  // validateModifiedOnly so orphan edits stay safe.
  sportId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Sport",
    required: true,
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
    sourceRound: { type: Number, default: 1 },
    // True when this Top Player is seeded to skip Round 2 — they go straight
    // to Round 3 (final knockout) without playing the Round 2 sub-stage.
    skipRound2: { type: Boolean, default: false }
  }],
  players: [{ // Added for compatibility with controller referencing group.players
    playerId: String,
    playerName: String,
    userName: String,
    category: String,
    points: { type: Number, default: 0 },
    skipRound2: { type: Boolean, default: false }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Multi-sport scoping index. Non-unique — STEP 9a additive.
topPlayersSchema.index({ tournamentId: 1, sportId: 1 });

module.exports = mongoose.model('TopPlayers', topPlayersSchema);