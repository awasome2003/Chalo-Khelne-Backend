const mongoose = require('mongoose');

const bookingTopGroupSchema = new mongoose.Schema({
  tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
  groupName: { type: String, required: true },
  players: [
    {
      playerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', required: true }, // References Player schema
      playerName: { type: String, required: true }, // Includes the player's name
    },
  ],
});

module.exports = mongoose.model('BookingTopGroup', bookingTopGroupSchema);
