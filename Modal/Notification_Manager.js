const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  managerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Manager",
    required: true,
  },
  type: {
    type: String,
    required: true,
    enum: ["match_reminder", "system_notification"],
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    required: true,
    trim: true,
  },
  time: {
    type: Date,
    required: true,
  },
  matchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "TournamentMatch",
  },
  tournamentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tournament",
  },
  status: {
    type: String,
    enum: ["pending", "sent", "read"],
    default: "pending",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Check if model exists before compiling
module.exports =
  mongoose.models.Notification ||
  mongoose.model("Notification", notificationSchema);
