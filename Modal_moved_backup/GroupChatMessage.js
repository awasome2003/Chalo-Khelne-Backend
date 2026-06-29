const mongoose = require("mongoose");

const groupChatMessageSchema = new mongoose.Schema(
  {
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: "GroupChat", required: true, index: true },
    senderId: { type: String, required: true },
    senderName: { type: String, required: true },
    senderRole: { type: String, default: "Player" },
    text: { type: String, default: "" },
    attachments: [
      {
        url: { type: String, required: true },
        name: { type: String, default: "file" },
        type: { type: String, default: "file" },
        size: { type: Number, default: 0 },
      },
    ],
  },
  { timestamps: true }
);

groupChatMessageSchema.index({ chatId: 1, createdAt: -1 });

module.exports = mongoose.model("GroupChatMessage", groupChatMessageSchema);
