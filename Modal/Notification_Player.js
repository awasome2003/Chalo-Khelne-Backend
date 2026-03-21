const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  matchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Match",
    required: true,
  },
  playerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  userName: { type: String, required: true },
  reminderTime: { type: Date, required: true, index: true },
  minutesBefore: { type: Number, required: true, enum: [20, 10, 5] },
  isProcessed: { type: Boolean, default: false, index: true },
  sentAt: { type: Date },
  pushToken: { type: String },
  error: { type: String },
  retryCount: { type: Number, default: 0 },
});

// Add index for querying pending notifications
notificationSchema.index({ isProcessed: 1, reminderTime: 1 });

module.exports = mongoose.model("Notifications", notificationSchema);
