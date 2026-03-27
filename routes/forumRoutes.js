const express = require("express");
const router = express.Router();
const ForumCategory = require("../Modal/ForumCategory");
const ForumThread = require("../Modal/ForumThread");
const ForumReply = require("../Modal/ForumReply");

// ════════════════════════════════════
// CATEGORIES
// ════════════════════════════════════

router.get("/categories", async (req, res) => {
  try {
    const categories = await ForumCategory.find({ isActive: true }).sort({ order: 1 }).lean();
    res.json({ success: true, categories });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/categories", async (req, res) => {
  try {
    const { name, description, icon, color } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "Name is required" });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const existing = await ForumCategory.findOne({ slug });
    if (existing) return res.status(400).json({ success: false, message: "Category already exists" });
    const category = await ForumCategory.create({ name, slug, description, icon, color });
    res.status(201).json({ success: true, category });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ════════════════════════════════════
// THREADS
// ════════════════════════════════════

router.get("/threads", async (req, res) => {
  try {
    const { categoryId, page = 1, limit = 20, sort = "newest" } = req.query;
    const filter = {};
    if (categoryId) filter.categoryId = categoryId;

    const sortMap = {
      newest: { createdAt: -1 },
      popular: { likes: -1, replyCount: -1 },
      active: { lastReplyAt: -1 },
    };

    const threads = await ForumThread.find(filter)
      .sort(sortMap[sort] || sortMap.newest)
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();

    const total = await ForumThread.countDocuments(filter);

    res.json({
      success: true,
      threads,
      pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/threads/:id", async (req, res) => {
  try {
    const thread = await ForumThread.findByIdAndUpdate(
      req.params.id,
      { $inc: { viewCount: 1 } },
      { new: true }
    ).lean();
    if (!thread) return res.status(404).json({ success: false, message: "Thread not found" });
    res.json({ success: true, thread });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/threads", async (req, res) => {
  try {
    const { title, content, authorId, authorName, authorRole, categoryId, tags } = req.body;
    if (!title || !content || !authorId || !categoryId) {
      return res.status(400).json({ success: false, message: "title, content, authorId, categoryId required" });
    }

    const parsedTags = (tags || []).map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, "")).filter(Boolean);

    const thread = await ForumThread.create({
      title: title.trim(),
      content,
      authorId,
      authorName: authorName || "User",
      authorRole: authorRole || "Player",
      categoryId,
      tags: parsedTags,
    });

    await ForumCategory.findByIdAndUpdate(categoryId, { $inc: { threadCount: 1 } });

    res.status(201).json({ success: true, thread });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ════════════════════════════════════
// LIKES
// ════════════════════════════════════

router.post("/threads/:id/like", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: "userId required" });

    const thread = await ForumThread.findById(req.params.id);
    if (!thread) return res.status(404).json({ success: false, message: "Thread not found" });

    const idx = thread.likes.indexOf(userId);
    if (idx === -1) {
      thread.likes.push(userId);
    } else {
      thread.likes.splice(idx, 1);
    }
    await thread.save();

    res.json({ success: true, likes: thread.likes, liked: idx === -1 });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ════════════════════════════════════
// REPLIES
// ════════════════════════════════════

router.get("/threads/:id/replies", async (req, res) => {
  try {
    const replies = await ForumReply.find({ threadId: req.params.id, isDeleted: false })
      .sort({ createdAt: 1 })
      .lean();
    res.json({ success: true, replies });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/threads/:id/reply", async (req, res) => {
  try {
    const { content, authorId, authorName, authorRole, parentReplyId } = req.body;
    if (!content || !authorId) {
      return res.status(400).json({ success: false, message: "content and authorId required" });
    }

    const thread = await ForumThread.findById(req.params.id);
    if (!thread) return res.status(404).json({ success: false, message: "Thread not found" });
    if (thread.isLocked) return res.status(403).json({ success: false, message: "Thread is locked" });

    const reply = await ForumReply.create({
      content,
      authorId,
      authorName: authorName || "User",
      authorRole: authorRole || "Player",
      threadId: req.params.id,
      parentReplyId: parentReplyId || null,
    });

    thread.replyCount += 1;
    thread.lastReplyAt = new Date();
    thread.lastReplyBy = authorName || "User";
    await thread.save();

    res.status(201).json({ success: true, reply });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/replies/:id/like", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: "userId required" });

    const reply = await ForumReply.findById(req.params.id);
    if (!reply) return res.status(404).json({ success: false, message: "Reply not found" });

    const idx = reply.likes.indexOf(userId);
    if (idx === -1) reply.likes.push(userId);
    else reply.likes.splice(idx, 1);
    await reply.save();

    res.json({ success: true, likes: reply.likes, liked: idx === -1 });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
