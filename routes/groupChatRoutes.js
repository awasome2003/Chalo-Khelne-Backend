const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const GroupChat = require("../Modal/GroupChat");
const GroupChatMessage = require("../Modal/GroupChatMessage");
const User = require("../Modal/User");
const { Manager } = require("../Modal/ClubManager");
const { allowUserOrManager } = require("../middleware/authMiddleware");

// File upload
const uploadsDir = path.join(__dirname, "../uploads/group-chat");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadsDir),
  filename: (_, file, cb) => cb(null, `gc-${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ════════════════════════════════════
// AUTH — every group-chat route requires a valid token (User/Manager/SuperAdmin)
// ════════════════════════════════════
router.use(allowUserOrManager);

// ════════════════════════════════════
// CALLER IDENTITY — derived from the verified token, NEVER from the request body.
// allowUserOrManager sets req.user to the DB document (User or Manager) and
// req.userRole to "User" | "Manager" | "SuperAdmin". This is the single source
// of truth for who the caller is — clients can no longer spoof createdBy /
// requesterId / senderId.
// ════════════════════════════════════
function caller(req) {
  const id = String(req.user._id || req.user.id);
  const name = req.user.name || req.user.fullName || "User";
  const role =
    req.userRole === "Manager"
      ? "Manager"
      : req.userRole === "SuperAdmin"
      ? "SuperAdmin"
      : req.user.role || "Player";
  return { id, name, role };
}

// ════════════════════════════════════
// OWNERSHIP / MEMBERSHIP HELPERS
// ════════════════════════════════════
function isOwner(chat, userId) {
  return String(chat.createdBy) === String(userId);
}

function isMember(chat, userId) {
  return (
    String(chat.createdBy) === String(userId) ||
    (chat.members || []).some((m) => String(m.userId) === String(userId))
  );
}

// ════════════════════════════════════
// SEARCH USERS (for adding members) — authenticated only
// ════════════════════════════════════
router.get("/search-users", async (req, res) => {
  try {
    const q = req.query.q || "";
    if (q.length < 1) return res.json({ success: true, users: [] });
    const regex = { $regex: q, $options: "i" };

    const players = await User.find({ name: regex }).select("name email role profileImage").limit(15).lean();
    const managers = await Manager.find({ name: regex }).select("name email").limit(10).lean();

    const all = [
      ...players.map((p) => ({ _id: p._id.toString(), name: p.name, email: p.email, role: p.role || "Player" })),
      ...managers.map((m) => ({ _id: m._id.toString(), name: m.name, email: m.email, role: "Manager" })),
    ];
    res.json({ success: true, users: all });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ════════════════════════════════════
// CREATE CHAT (any authenticated user — becomes owner)
// ════════════════════════════════════
router.post("/", async (req, res) => {
  try {
    const { name, description, members } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "name required" });

    const me = caller(req);

    // Owner auto-added as first member; identity comes from the token, not the body.
    const memberList = [
      { userId: me.id, name: me.name, role: me.role },
      ...(Array.isArray(members) ? members : []).filter((m) => m && m.userId && String(m.userId) !== me.id),
    ];

    const chat = await GroupChat.create({
      name,
      description,
      createdBy: me.id,
      createdByName: me.name,
      createdByRole: me.role,
      members: memberList,
    });

    res.status(201).json({ success: true, chat });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ════════════════════════════════════
// GET CALLER'S CHATS
// ════════════════════════════════════
router.get("/", async (req, res) => {
  try {
    const me = caller(req);

    const chats = await GroupChat.find({ "members.userId": me.id })
      .sort({ lastMessageAt: -1, createdAt: -1 }).lean();

    // Mark ownership for each chat
    const result = chats.map((c) => ({ ...c, isOwner: String(c.createdBy) === me.id }));
    res.json({ success: true, chats: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ════════════════════════════════════
// GET SINGLE CHAT (members only)
// ════════════════════════════════════
router.get("/:id", async (req, res) => {
  try {
    const me = caller(req);
    const chat = await GroupChat.findById(req.params.id).lean();
    if (!chat) return res.status(404).json({ success: false, message: "Chat not found" });
    if (!isMember(chat, me.id)) {
      return res.status(403).json({ success: false, message: "Not a member of this chat" });
    }
    res.json({ success: true, chat });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ════════════════════════════════════
// RENAME CHAT (owner only)
// ════════════════════════════════════
router.put("/:id/rename", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "name required" });
    }

    const me = caller(req);
    const chat = await GroupChat.findById(req.params.id);
    if (!chat) return res.status(404).json({ success: false, message: "Chat not found" });

    if (!isOwner(chat, me.id)) {
      return res.status(403).json({ success: false, message: "Only the chat owner can rename this chat" });
    }

    chat.name = name.trim();
    await chat.save();

    const io = req.app.get("io");
    if (io) io.to(`gchat_${chat._id}`).emit("gchat:updated", { chatId: chat._id, action: "renamed", name: chat.name });

    res.json({ success: true, chat });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ════════════════════════════════════
// ADD MEMBER (owner only)
// ════════════════════════════════════
router.post("/:id/add", async (req, res) => {
  try {
    const { userId, name, role } = req.body;
    if (!userId || !name) return res.status(400).json({ success: false, message: "userId, name required" });

    const me = caller(req);
    const chat = await GroupChat.findById(req.params.id);
    if (!chat) return res.status(404).json({ success: false, message: "Chat not found" });

    // STRICT: only owner can add
    if (!isOwner(chat, me.id)) {
      return res.status(403).json({ success: false, message: "Only the chat owner can add members" });
    }

    if (chat.members.some((m) => String(m.userId) === String(userId))) {
      return res.status(400).json({ success: false, message: "Already a member" });
    }

    chat.members.push({ userId, name, role: role || "Player" });
    await chat.save();

    const io = req.app.get("io");
    if (io) io.to(`gchat_${chat._id}`).emit("gchat:updated", { chatId: chat._id, action: "member_added", member: { userId, name, role } });

    res.json({ success: true, chat });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ════════════════════════════════════
// REMOVE MEMBER (owner only)
// ════════════════════════════════════
router.post("/:id/remove", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: "userId required" });

    const me = caller(req);
    const chat = await GroupChat.findById(req.params.id);
    if (!chat) return res.status(404).json({ success: false, message: "Chat not found" });

    if (!isOwner(chat, me.id)) {
      return res.status(403).json({ success: false, message: "Only the chat owner can remove members" });
    }

    // Cannot remove owner
    if (String(userId) === String(chat.createdBy)) {
      return res.status(400).json({ success: false, message: "Cannot remove the chat owner" });
    }

    chat.members = chat.members.filter((m) => String(m.userId) !== String(userId));
    await chat.save();

    const io = req.app.get("io");
    if (io) {
      io.to(`gchat_${chat._id}`).emit("gchat:updated", { chatId: chat._id, action: "member_removed", userId });
      // Kick removed user from socket room
      io.to(`gchat_${chat._id}`).emit("gchat:kicked", { chatId: chat._id, userId });
    }

    res.json({ success: true, chat });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ════════════════════════════════════
// DELETE CHAT (owner only) — cascades
// ════════════════════════════════════
router.delete("/:id", async (req, res) => {
  try {
    const me = caller(req);
    const chat = await GroupChat.findById(req.params.id);
    if (!chat) return res.status(404).json({ success: false, message: "Chat not found" });

    if (!isOwner(chat, me.id)) {
      return res.status(403).json({ success: false, message: "Only the chat owner can delete this chat" });
    }

    // Delete all messages
    await GroupChatMessage.deleteMany({ chatId: chat._id });

    // Notify members before deletion
    const io = req.app.get("io");
    if (io) io.to(`gchat_${chat._id}`).emit("gchat:deleted", { chatId: chat._id, deletedBy: me.id });

    // Delete chat
    await GroupChat.findByIdAndDelete(chat._id);

    res.json({ success: true, message: "Chat and all messages deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ════════════════════════════════════
// GET MESSAGES (members only)
// ════════════════════════════════════
router.get("/:id/messages", async (req, res) => {
  try {
    const me = caller(req);
    const chat = await GroupChat.findById(req.params.id).select("members createdBy").lean();
    if (!chat) return res.status(404).json({ success: false, message: "Chat not found" });
    if (!isMember(chat, me.id)) {
      return res.status(403).json({ success: false, message: "Not a member of this chat" });
    }

    const { before } = req.query;
    const filter = { chatId: req.params.id };
    if (before) filter.createdAt = { $lt: new Date(before) };

    const messages = await GroupChatMessage.find(filter)
      .sort({ createdAt: 1 })
      .limit(100)
      .lean();

    res.json({ success: true, messages });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ════════════════════════════════════
// SEND MESSAGE (members only)
// ════════════════════════════════════
router.post("/:id/message", upload.array("files", 5), async (req, res) => {
  try {
    const { text } = req.body;
    const me = caller(req);

    const chat = await GroupChat.findById(req.params.id);
    if (!chat) return res.status(404).json({ success: false, message: "Chat not found" });

    if (!isMember(chat, me.id)) {
      return res.status(403).json({ success: false, message: "Not a member of this chat" });
    }

    const attachments = (req.files || []).map((file) => ({
      url: `uploads/group-chat/${file.filename}`,
      name: file.originalname,
      type: file.mimetype,
      size: file.size,
    }));

    if (!text && attachments.length === 0) {
      return res.status(400).json({ success: false, message: "Message or attachment required" });
    }

    const message = await GroupChatMessage.create({
      chatId: chat._id,
      senderId: me.id,
      senderName: me.name,
      senderRole: me.role,
      text: text || "",
      attachments,
    });

    // Update chat metadata
    chat.lastMessageAt = message.createdAt;
    chat.lastMessageText = text || (attachments.length > 0 ? `📎 ${attachments.length} file(s)` : "");
    chat.lastMessageBy = me.name;
    chat.messageCount += 1;
    await chat.save();

    // Real-time
    const io = req.app.get("io");
    if (io) io.to(`gchat_${chat._id}`).emit("gchat:message", message);

    res.status(201).json({ success: true, message });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
