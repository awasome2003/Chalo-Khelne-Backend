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

  // ── Cron bookkeeping (§3.3) ────────────────────────────────────────────
  // When this row was claimed by a cron tick. The claim is what stops two
  // overlapping ticks from sending the same reminder twice; a row claimed
  // longer ago than the cron's timeout is treated as abandoned (the process
  // died mid-send) and becomes eligible again.
  claimedAt: { type: Date, default: null },

  // Why the row reached a terminal state: "sent", "no_push_token", or
  // "send_failed: …". Tokenless rows used to be skipped WITHOUT being marked
  // processed, so they were re-selected on every run forever and the query
  // scanned an ever-growing backlog sixty times an hour.
  processedReason: { type: String, default: null },
});

// Add index for querying pending notifications
notificationSchema.index({ isProcessed: 1, reminderTime: 1 });
// The cron's claim query filters on isProcessed + reminderTime + claimedAt.
notificationSchema.index({ isProcessed: 1, reminderTime: 1, claimedAt: 1 });

module.exports = mongoose.model("Notifications", notificationSchema);
