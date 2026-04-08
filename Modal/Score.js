const mongoose = require("mongoose");

const ScoreSchema = new mongoose.Schema(
  {
    matchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TournamentMatch",
      required: true,
    },
    playerA: {
      type: String,
      required: true,
    },
    playerB: {
      type: String,
      required: true,
    },
    // Sport-neutral normalized result (preferred for non-set sports)
    matchResult: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    // Scoring type that produced this score
    scoringType: {
      type: String,
      default: null,
    },
    // ══ REMOVED (Phase 11): Legacy setOne-setSeven fields ══
    // These fields existed for backward compatibility but are no longer written to.
    // Historical data may still contain values in these fields.
    // All new reads MUST use sets[] array or matchResult.
    // Fields removed from schema — Mongoose will ignore them on read (they persist in DB).
    // Dynamic sets array — works for any number of sets
    sets: [{
      setNumber: { type: Number, required: true },
      gamesWonA: { type: Number, default: 0 },
      gamesWonB: { type: Number, default: 0 },
      pointsScoredA: { type: Number, default: 0 },
      pointsScoredB: { type: Number, default: 0 },
      winner: { type: String, default: null },
      _id: false,
    }],
    // Games won/lost tracking (per docx requirement 6.1)
    gamesWonA: {
      type: Number,
      default: 0,
    },
    gamesWonB: {
      type: Number,
      default: 0,
    },
    // Total scores tracking (cumulative points per docx requirement 6.1)
    totalScoreA: {
      type: Number,
      default: 0,
    },
    totalScoreB: {
      type: Number,
      default: 0,
    },
    winner: {
      type: String,
      default: null,
    },
    matchStatus: {
      type: String,
      enum: ["IN_PROGRESS", "COMPLETED"],
      default: "IN_PROGRESS",
    },
  },
  {
    timestamps: true,
  }
);

// Check if the model already exists to prevent OverwriteModelError
const Score = mongoose.models.Score || mongoose.model("Score", ScoreSchema);

module.exports = Score;
