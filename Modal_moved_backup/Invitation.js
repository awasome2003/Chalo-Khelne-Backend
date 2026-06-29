const mongoose = require("mongoose");

const invitationSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    senderName: {
      type: String,
      required: true,
      trim: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverName: {
      type: String,
      required: true,
      trim: true,
    },

    // Invitation category. "tournament" keeps the legacy behavior; the others
    // are casual invites that don't require a tournament.
    invitationType: {
      type: String,
      enum: ["play_with_me", "turf_match", "sports_event", "tournament"],
      default: "tournament",
    },

    // Tournament is now OPTIONAL — only set for tournament-type invites.
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      default: null,
    },
    tournamentName: {
      type: String,
      trim: true,
      default: "",
    },

    // Event metadata for casual invites (and a friendly snapshot for tournaments)
    sport: { type: String, trim: true, default: "" },
    eventDate: { type: String, default: "" }, // "YYYY-MM-DD" as sent by the form
    startTime: { type: String, default: "" }, // "6:00 PM"
    endTime: { type: String, default: "" },
    venue: { type: String, trim: true, default: "" },

    // Groups a single bulk send to multiple players so the Sent tab can collapse them
    batchId: { type: String, default: null },

    message: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "pending",
    },
    respondedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Prevent duplicate tournament invitations (same sender → receiver → tournament).
// Partial filter so casual invites (tournamentId null) aren't constrained by it.
invitationSchema.index(
  { senderId: 1, receiverId: 1, tournamentId: 1 },
  {
    unique: true,
    partialFilterExpression: { tournamentId: { $type: "objectId" } },
  }
);
invitationSchema.index({ receiverId: 1, status: 1 });
invitationSchema.index({ senderId: 1 });
invitationSchema.index({ tournamentId: 1 });
invitationSchema.index({ batchId: 1 });
// Sorted reads (newest first) for received / sent / by-tournament lists.
invitationSchema.index({ receiverId: 1, createdAt: -1 });
invitationSchema.index({ senderId: 1, createdAt: -1 });
invitationSchema.index({ tournamentId: 1, createdAt: -1 });

module.exports = mongoose.model("Invitation", invitationSchema);
