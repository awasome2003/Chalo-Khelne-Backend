const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const ForumRoom = require("../Modal/ForumRoom");
const ForumMessage = require("../Modal/ForumMessage");

// File upload config
const uploadsDir = path.join(__dirname, "../uploads/forum");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadsDir),
  filename: (_, file, cb) => cb(null, `forum-${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

// ════════════════════════════════════
// FORUM ROOMS
// ════════════════════════════════════

// Create forum (SuperAdmin)
router.post("/", async (req, res) => {
  try {
    const { name, description, createdBy, createdByName, icon, members } = req.body;
    if (!name || !createdBy) return res.status(400).json({ success: false, message: "name and createdBy required" });

    const room = await ForumRoom.create({
      name: name.trim(),
      description: description || "",
      createdBy,
      createdByName: createdByName || "SuperAdmin",
      icon: icon || "💬",
      members: members || [],
    });

    res.status(201).json({ success: true, forum: room });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get forums for a user
router.get("/", async (req, res) => {
  try {
    const { userId } = req.query;
    const filter = userId ? { "members.userId": userId, isActive: true } : { isActive: true };
    const forums = await ForumRoom.find(filter).sort({ lastMessageAt: -1, createdAt: -1 }).lean();
    res.json({ success: true, forums });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get all forums (SuperAdmin)
router.get("/all", async (req, res) => {
  try {
    const forums = await ForumRoom.find({}).sort({ createdAt: -1 }).lean();
    res.json({ success: true, forums });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get single forum
router.get("/:id", async (req, res) => {
  try {
    const forum = await ForumRoom.findById(req.params.id).lean();
    if (!forum) return res.status(404).json({ success: false, message: "Forum not found" });
    res.json({ success: true, forum });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Add member
router.post("/:id/add-member", async (req, res) => {
  try {
    const { userId, name, role } = req.body;
    if (!userId || !name) return res.status(400).json({ success: false, message: "userId and name required" });

    const forum = await ForumRoom.findById(req.params.id);
    if (!forum) return res.status(404).json({ success: false, message: "Forum not found" });

    if (forum.members.some((m) => m.userId.toString() === userId)) {
      return res.status(400).json({ success: false, message: "Already a member" });
    }

    forum.members.push({ userId, name, role: role || "Player" });
    await forum.save();

    // Notify via socket
    const io = req.app.get("io");
    if (io) io.to(`forum_${forum._id}`).emit("forum:updated", { forumId: forum._id, action: "member_added", member: { userId, name, role } });

    res.json({ success: true, forum });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Remove member
router.post("/:id/remove-member", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: "userId required" });

    const forum = await ForumRoom.findById(req.params.id);
    if (!forum) return res.status(404).json({ success: false, message: "Forum not found" });

    forum.members = forum.members.filter((m) => m.userId.toString() !== userId);
    await forum.save();

    const io = req.app.get("io");
    if (io) io.to(`forum_${forum._id}`).emit("forum:updated", { forumId: forum._id, action: "member_removed", userId });

    res.json({ success: true, forum });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ════════════════════════════════════
// MESSAGES
// ════════════════════════════════════

// Get messages
router.get("/:id/messages", async (req, res) => {
  try {
    const { before, limit = 50 } = req.query;
    const filter = { forumId: req.params.id, isDeleted: false };
    if (before) filter.createdAt = { $lt: new Date(before) };

    const messages = await ForumMessage.find(filter)
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .lean();

    res.json({ success: true, messages: messages.reverse() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Send message (with optional attachments)
router.post("/:id/message", upload.array("files", 5), async (req, res) => {
  try {
    const { senderId, senderName, senderRole, text } = req.body;
    if (!senderId) return res.status(400).json({ success: false, message: "senderId required" });
    if (!text && (!req.files || req.files.length === 0)) {
      return res.status(400).json({ success: false, message: "text or attachment required" });
    }

    const forum = await ForumRoom.findById(req.params.id);
    if (!forum) return res.status(404).json({ success: false, message: "Forum not found" });

    // Check membership
    const isMember = forum.members.some((m) => m.userId.toString() === senderId);
    if (!isMember) return res.status(403).json({ success: false, message: "Not a member of this forum" });

    // Process attachments
    const attachments = (req.files || []).map((file) => ({
      url: `uploads/forum/${file.filename}`,
      name: file.originalname,
      type: file.mimetype.startsWith("image") ? "image" : file.mimetype === "application/pdf" ? "pdf" : "file",
      size: file.size,
    }));

    const message = await ForumMessage.create({
      forumId: req.params.id,
      senderId,
      senderName: senderName || "User",
      senderRole: senderRole || "Player",
      text: text || "",
      attachments,
    });

    // Update forum metadata
    forum.lastMessageAt = new Date();
    forum.lastMessageText = text ? (text.length > 50 ? text.substring(0, 50) + "..." : text) : "📎 Attachment";
    forum.lastMessageBy = senderName || "User";
    forum.messageCount += 1;
    await forum.save();

    // Emit to forum room
    const io = req.app.get("io");
    if (io) {
      io.to(`forum_${req.params.id}`).emit("forum:message", {
        forumId: req.params.id,
        message: message.toObject(),
      });
    }

    res.status(201).json({ success: true, message });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
