const mongoose = require("mongoose");

/**
 * A direct hire request from a player/organizer (fromUser) to a
 * professional (toUser, identified by a ProfessionalProfile). The pro
 * accepts or rejects it. `seen=false` drives the "New" badge.
 */
const hireRequestSchema = new mongoose.Schema(
  {
    fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    fromName: { type: String, default: "" },

    toUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    toProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProfessionalProfile",
      default: null,
    },

    title: { type: String, default: "" }, // event name
    role: { type: String, default: "" },
    sport: { type: String, default: "" },
    location: { type: String, default: "" },
    eventDate: { type: String, default: "" },
    duration: { type: String, default: "" },
    offerPayment: { type: String, default: "" },
    description: { type: String, default: "" },

    status: { type: String, enum: ["pending", "accepted", "rejected"], default: "pending" },
    seen: { type: Boolean, default: false },
  },
  { timestamps: true }
);

hireRequestSchema.index({ toUserId: 1, status: 1 });
// Received hire requests, newest first.
hireRequestSchema.index({ toUserId: 1, createdAt: -1 });

module.exports = mongoose.model("HireRequest", hireRequestSchema);
