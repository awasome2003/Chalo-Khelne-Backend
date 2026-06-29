const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
    messageType: {
      type: String,
      enum: ["text", "image"],
      default: "text",
    },
    imageUrl: { type: String, default: null },
    readBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  { timestamps: true }
);

// Fast message lookup by conversation, newest first
messageSchema.index({ conversationId: 1, createdAt: -1 });
// For unread count queries
messageSchema.index({ conversationId: 1, sender: 1, readBy: 1 });

module.exports = mongoose.model("Message", messageSchema);
