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
    setOne: {
      type: [Number],
      required: true,
    },
    setTwo: {
      type: [Number],
      required: true,
    },
    setThree: {
      type: [Number],
    },
    // 🚀 ENHANCED SET SUPPORT - Best of 5 and Best of 7 matches
    setFour: {
      type: [Number],
      default: null,
      comment: "For Best of 7 matches (first to win 4 sets)"
    },
    setFive: {
      type: [Number],
      default: null,
      comment: "For Best of 7 matches (first to win 4 sets)"
    },
    setSix: {
      type: [Number],
      default: null,
      comment: "For Best of 7 matches (first to win 4 sets)"
    },
    setSeven: {
      type: [Number],
      default: null,
      comment: "For Best of 7 matches (first to win 4 sets)"
    },
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
      required: true,
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
