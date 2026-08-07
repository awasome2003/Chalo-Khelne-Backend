const mongoose = require("mongoose");

/**
 * ClubBroadcast — a broadcast announcement composed by a facility Club (Club OS).
 * Tenant-scoped by clubId. Records the message + resolved audience size + status.
 * NOTE: actual external dispatch (WhatsApp/SMS/Email/Push) needs a provider
 * integration; this logs the broadcast and computes the recipient count.
 */
const clubBroadcastSchema = new mongoose.Schema(
  {
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    channel: { type: String, enum: ["Push", "SMS", "WhatsApp", "Email"], default: "WhatsApp" },
    audience: { type: String, enum: ["Members", "Coaches", "Staff", "Tournament Players"], default: "Members" },
    subject: { type: String, default: "" },
    text: { type: String, required: true, trim: true },
    recipientCount: { type: Number, default: 0 },
    status: { type: String, enum: ["Queued", "Sent", "Failed"], default: "Queued" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

clubBroadcastSchema.index({ clubId: 1, createdAt: -1 });

module.exports = mongoose.model("ClubBroadcast", clubBroadcastSchema);
