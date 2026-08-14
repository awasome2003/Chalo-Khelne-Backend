const mongoose = require("mongoose");

const reminderSchema = new mongoose.Schema({
  matchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "TournamentMatch",
    required: true,
  },
  tournamentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tournament",
    required: true,
  },
  reminderTime: {
    type: Date,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ["pending", "sent", "disabled"],
    default: "pending",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});


// ── Indexes (§7.3 — this model declared none) ──────────────────────────
// the reminder cron's due-rows query
reminderSchema.index({ status: 1, reminderTime: 1 });
// reminders for a match
reminderSchema.index({ matchId: 1 });

module.exports = mongoose.model("Reminder", reminderSchema);
