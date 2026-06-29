const mongoose = require("mongoose");

const groupChatSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, default: "", maxlength: 500 },
    createdBy: { type: String, required: true }, // Owner ID (string for cross-model compat)
    createdByName: { type: String, default: "User" },
    createdByRole: { type: String, default: "Player" },
    members: [
      {
        userId: { type: String, required: true },
        name: { type: String, required: true },
        role: { type: String, default: "Player" },
        joinedAt: { type: Date, default: Date.now },
      },
    ],
    lastMessageAt: { type: Date, default: null },
    lastMessageText: { type: String, default: null },
    lastMessageBy: { type: String, default: null },
    messageCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

groupChatSchema.index({ "members.userId": 1 });
groupChatSchema.index({ createdBy: 1 });
groupChatSchema.index({ lastMessageAt: -1 });

module.exports = mongoose.model("GroupChat", groupChatSchema);
