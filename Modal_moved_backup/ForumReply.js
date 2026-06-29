const mongoose = require("mongoose");

const forumReplySchema = new mongoose.Schema(
  {
    content: { type: String, required: true, maxlength: 5000 },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    authorName: { type: String, required: true },
    authorRole: { type: String, default: "Player" },
    threadId: { type: mongoose.Schema.Types.ObjectId, ref: "ForumThread", required: true },
    parentReplyId: { type: mongoose.Schema.Types.ObjectId, ref: "ForumReply", default: null },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

forumReplySchema.index({ threadId: 1, createdAt: 1 });
forumReplySchema.index({ parentReplyId: 1 });

module.exports = mongoose.model("ForumReply", forumReplySchema);
