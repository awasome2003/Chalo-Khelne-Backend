const mongoose = require("mongoose");

const forumRoomSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, default: "", maxlength: 500 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
    createdByName: { type: String, default: "SuperAdmin" },
    members: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, required: true },
        name: { type: String, required: true },
        role: { type: String, default: "Player" },
        joinedAt: { type: Date, default: Date.now },
      },
    ],
    icon: { type: String, default: "💬" },
    isActive: { type: Boolean, default: true },
    lastMessageAt: { type: Date, default: null },
    lastMessageText: { type: String, default: null },
    lastMessageBy: { type: String, default: null },
    messageCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

forumRoomSchema.index({ "members.userId": 1 });
forumRoomSchema.index({ lastMessageAt: -1 });

module.exports = mongoose.model("ForumRoom", forumRoomSchema);
