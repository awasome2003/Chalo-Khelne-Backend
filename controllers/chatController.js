const Conversation = require("../Modal/Conversation");
const Message = require("../Modal/Message");
const User = require("../Modal/User");
const mongoose = require("mongoose");

const chatController = {
  // GET /api/chat/conversations — list user's conversations
  getConversations: async (req, res) => {
    try {
      const userId = req.user.id;

      const conversations = await Conversation.find({
        participants: userId,
        isActive: true,
      })
        .populate("participants", "name profileImage role")
        .populate("lastMessage.sender", "name")
        .sort({ updatedAt: -1 });

      // Format response — attach the "other" user info
      const formatted = conversations.map((conv) => {
        const other = conv.participants.find(
          (p) => p._id.toString() !== userId
        );
        return {
          _id: conv._id,
          otherUser: other,
          lastMessage: conv.lastMessage,
          unreadCount: conv.unreadCount?.get(userId) || 0,
          updatedAt: conv.updatedAt,
        };
      });

      res.json({ success: true, conversations: formatted });
    } catch (error) {
      console.error("[CHAT] Error fetching conversations:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // POST /api/chat/conversations — create or get existing conversation
  createOrGetConversation: async (req, res) => {
    try {
      const userId = req.user.id;
      const { participantId } = req.body;

      if (!participantId) {
        return res.status(400).json({ success: false, message: "participantId is required" });
      }

      if (userId === participantId) {
        return res.status(400).json({ success: false, message: "Cannot chat with yourself" });
      }

      // Check if other user exists
      const otherUser = await User.findById(participantId).select("name profileImage role");
      if (!otherUser) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      // Check if conversation already exists
      let conversation = await Conversation.findOne({
        participants: { $all: [userId, participantId], $size: 2 },
        isActive: true,
      });

      if (!conversation) {
        conversation = await Conversation.create({
          participants: [userId, participantId],
          unreadCount: new Map([[userId, 0], [participantId, 0]]),
        });
      }

      await conversation.populate("participants", "name profileImage role");

      res.json({ success: true, conversation });
    } catch (error) {
      console.error("[CHAT] Error creating conversation:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // GET /api/chat/conversations/:id/messages — paginated message history
  getMessages: async (req, res) => {
    try {
      const userId = req.user.id;
      const { id: conversationId } = req.params;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 30;
      const skip = (page - 1) * limit;

      // Verify user is participant
      const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: userId,
      });

      if (!conversation) {
        return res.status(404).json({ success: false, message: "Conversation not found" });
      }

      const messages = await Message.find({ conversationId })
        .populate("sender", "name profileImage")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await Message.countDocuments({ conversationId });

      res.json({
        success: true,
        messages: messages.reverse(),
        pagination: {
          page,
          limit,
          total,
          hasMore: skip + limit < total,
        },
      });
    } catch (error) {
      console.error("[CHAT] Error fetching messages:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // POST /api/chat/messages/send — send a message
  sendMessage: async (req, res) => {
    try {
      const userId = req.user.id;
      const { conversationId, text, messageType, imageUrl } = req.body;

      if (!conversationId || !text?.trim()) {
        return res.status(400).json({ success: false, message: "conversationId and text are required" });
      }

      // Verify user is participant
      const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: userId,
      });

      if (!conversation) {
        return res.status(404).json({ success: false, message: "Conversation not found" });
      }

      // Create message
      const message = await Message.create({
        conversationId,
        sender: userId,
        text: text.trim(),
        messageType: messageType || "text",
        imageUrl: imageUrl || null,
        readBy: [userId],
      });

      // Update conversation's last message and unread counts
      const otherUserId = conversation.participants.find(
        (p) => p.toString() !== userId
      );

      const currentUnread = conversation.unreadCount?.get(otherUserId.toString()) || 0;
      conversation.lastMessage = {
        text: text.trim(),
        sender: userId,
        timestamp: new Date(),
      };
      conversation.unreadCount.set(otherUserId.toString(), currentUnread + 1);
      await conversation.save();

      // Populate sender for response
      await message.populate("sender", "name profileImage");

      // Emit via socket if available
      const io = req.app.get("io");
      if (io) {
        io.to(`user_${otherUserId}`).emit("message:new", {
          message,
          conversationId,
        });
      }

      // Save notification record for chat message
      try {
        const { notifyPlayer } = require("../utils/playerNotify");
        const senderName = message.sender?.name || "Someone";
        // Only save DB record, skip push (handled separately below)
        const PlayerNotification = require("../Modal/PlayerNotification");
        await PlayerNotification.create({
          userId: otherUserId,
          type: "chat_message",
          title: senderName,
          message: text.trim().substring(0, 100),
          data: { conversationId, senderName },
        });
      } catch (notifErr) {}

      // Send push notification to offline user
      try {
        const otherUser = await User.findById(otherUserId).select("expoPushToken name");
        const senderUser = await User.findById(userId).select("name");
        if (otherUser?.expoPushToken) {
          const { Expo } = require("expo-server-sdk");
          const expo = new Expo();
          if (Expo.isExpoPushToken(otherUser.expoPushToken)) {
            await expo.sendPushNotificationsAsync([
              {
                to: otherUser.expoPushToken,
                title: senderUser?.name || "New Message",
                body: text.trim().substring(0, 100),
                data: { type: "chat", conversationId },
                sound: "default",
              },
            ]);
          }
        }
      } catch (pushErr) {
        console.error("[CHAT] Push notification error:", pushErr.message);
      }

      res.status(201).json({ success: true, message });
    } catch (error) {
      console.error("[CHAT] Error sending message:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // PUT /api/chat/messages/read/:conversationId — mark all as read
  markAsRead: async (req, res) => {
    try {
      const userId = req.user.id;
      const { conversationId } = req.params;

      // Verify participation
      const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: userId,
      });

      if (!conversation) {
        return res.status(404).json({ success: false, message: "Conversation not found" });
      }

      // Mark all unread messages as read
      await Message.updateMany(
        {
          conversationId,
          sender: { $ne: userId },
          readBy: { $nin: [userId] },
        },
        { $addToSet: { readBy: userId } }
      );

      // Reset unread count
      conversation.unreadCount.set(userId, 0);
      await conversation.save();

      // Notify sender via socket
      const io = req.app.get("io");
      if (io) {
        const otherUserId = conversation.participants.find(
          (p) => p.toString() !== userId
        );
        io.to(`user_${otherUserId}`).emit("message:read", { conversationId, readBy: userId });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[CHAT] Error marking as read:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // GET /api/chat/search-players?q= — search players to chat with
  searchPlayers: async (req, res) => {
    try {
      const userId = req.user.id;
      const query = req.query.q || "";

      if (query.length < 2) {
        return res.json({ success: true, players: [] });
      }

      const players = await User.find({
        _id: { $ne: userId },
        name: { $regex: query, $options: "i" },
        role: { $in: ["Player", "Trainer"] },
      })
        .select("name profileImage role")
        .limit(20);

      res.json({ success: true, players });
    } catch (error) {
      console.error("[CHAT] Error searching players:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // GET /api/chat/unread-total — total unread messages across all conversations
  getUnreadTotal: async (req, res) => {
    try {
      const userId = req.user.id;

      const conversations = await Conversation.find({
        participants: userId,
        isActive: true,
      });

      let total = 0;
      conversations.forEach((conv) => {
        total += conv.unreadCount?.get(userId) || 0;
      });

      res.json({ success: true, total });
    } catch (error) {
      console.error("[CHAT] Error fetching unread total:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },
};

module.exports = chatController;
