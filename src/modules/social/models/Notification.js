// models/Notification.js
const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    managerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Manager",
      required: true,
    },
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    registrationId: {
      type: String,
      ref: "Registration",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    paymentMethod: {
      type: String,
      enum: ["cash", "online"], // ✅ allowed values
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    transactionStatus: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "pending",
    },
  },
  { timestamps: true }
);


// ── Indexes (§7.3 — this model declared none) ──────────────────────────
// the manager notification inbox the dashboard POLLS — was a collection scan
notificationSchema.index({ managerId: 1, createdAt: -1 });
// per-tournament notifications
notificationSchema.index({ tournamentId: 1 });
// a player's own notifications
notificationSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
