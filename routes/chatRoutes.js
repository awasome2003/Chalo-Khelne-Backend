const express = require("express");
const router = express.Router();
const chatController = require("../controllers/chatController");
const { authenticate } = require("../middleware/authMiddleware");

// All chat routes require authentication
router.use(authenticate);

// Conversations
router.get("/conversations", chatController.getConversations);
router.post("/conversations", chatController.createOrGetConversation);
router.get("/conversations/:id/messages", chatController.getMessages);

// Messages
router.post("/messages/send", chatController.sendMessage);
router.put("/messages/read/:conversationId", chatController.markAsRead);

// Search & Utility
router.get("/search-players", chatController.searchPlayers);
router.get("/unread-total", chatController.getUnreadTotal);

module.exports = router;
