"use strict";
/**
 * PostComment (Phase 5) — extracted from Post.comments[].
 *
 * Embedded comments grew unbounded inside the Post document (a viral post →
 * MB-sized doc, write contention, the 16MB ceiling). Comments now live in their
 * own collection, referenced by postId.
 */
const mongoose = require("mongoose");

const postCommentSchema = new mongoose.Schema(
  {
    postId: { type: mongoose.Schema.Types.ObjectId, ref: "Post", required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    text: { type: String, required: true },
  },
  { timestamps: true }
);

// Hot path: a post's comments, newest first.
postCommentSchema.index({ postId: 1, createdAt: -1 });

// Social content is cross-tenant by design (no clubId) — no tenantScope plugin.
module.exports = mongoose.models.PostComment || mongoose.model("PostComment", postCommentSchema);
