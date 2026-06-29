const mongoose = require("mongoose");

const forumThreadSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    content: { type: String, required: true, maxlength: 10000 },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    authorName: { type: String, required: true },
    authorRole: { type: String, default: "Player" },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "ForumCategory", required: true },
    tags: [{ type: String, trim: true, lowercase: true }],
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    replyCount: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 },
    isPinned: { type: Boolean, default: false },
    isLocked: { type: Boolean, default: false },
    lastReplyAt: { type: Date, default: null },
    lastReplyBy: { type: String, default: null },
  },
  { timestamps: true }
);

forumThreadSchema.index({ categoryId: 1, createdAt: -1 });
forumThreadSchema.index({ authorId: 1 });
forumThreadSchema.index({ tags: 1 });

module.exports = mongoose.model("ForumThread", forumThreadSchema);
