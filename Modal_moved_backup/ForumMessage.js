const mongoose = require("mongoose");

const forumMessageSchema = new mongoose.Schema(
  {
    forumId: { type: mongoose.Schema.Types.ObjectId, ref: "ForumRoom", required: true, index: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, required: true },
    senderName: { type: String, required: true },
    senderRole: { type: String, default: "Player" },
    text: { type: String, default: "" },
    attachments: [
      {
        url: { type: String, required: true },
        name: { type: String, default: "file" },
        type: { type: String, default: "file" }, // image, pdf, file
        size: { type: Number, default: 0 },
      },
    ],
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

forumMessageSchema.index({ forumId: 1, createdAt: 1 });

module.exports = mongoose.model("ForumMessage", forumMessageSchema);
