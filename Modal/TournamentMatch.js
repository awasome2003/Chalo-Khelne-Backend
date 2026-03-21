const mongoose = require("mongoose");

const tournamentMatchSchema = new mongoose.Schema(
  {
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
    },
    title: String,
    type: String,
    matchStage: String,
    date: {
      type: Date,
      get: (date) => (date ? date.toISOString().split("T")[0] : null),
    },
    time: String,
    reminder: {
      isEnabled: {
        type: Boolean,
        default: true,
      },
      reminderTime: {
        type: Date,
      },
    },
    selectedCourt: String,
    teams: [
      {
        name: { type: String, required: true },
        image: { type: String, default: null }, // Made optional with default null
        score: { type: Number, default: 0 },
      },
    ],
  },
  { toJSON: { getters: true }, toObject: { getters: true } }
);

const TournamentMatch = mongoose.model(
  "TournamentMatch",
  tournamentMatchSchema
);

module.exports = TournamentMatch;
