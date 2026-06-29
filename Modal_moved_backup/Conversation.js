const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
  {
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    lastMessage: {
      text: { type: String, default: "" },
      sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      timestamp: { type: Date, default: Date.now },
    },
    unreadCount: {
      type: Map,
      of: Number,
      default: {},
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Ensure only 2 participants per conversation
conversationSchema.index({ participants: 1 });
// Fast lookup for user's conversations
conversationSchema.index({ "participants": 1, updatedAt: -1 });

module.exports = mongoose.model("Conversation", conversationSchema);
