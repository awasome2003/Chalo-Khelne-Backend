const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");

// Get all notifications for a user
router.get("/user/:userId", notificationController.getUserNotifications);

// Get unread notification count for a user
router.get("/user/:userId/count", notificationController.getUnreadCount);

// Mark a notification as read
router.put("/:notificationId/read", notificationController.markAsRead);

// Mark all notifications as read for a user
router.put("/user/:userId/read-all", notificationController.markAllAsRead);

router.put(
  "/user/:userId/expo-token",
  notificationController.updateExpoPushToken
);

// ── Player Notification Routes (new unified system) ──
const PlayerNotification = require("../Modal/PlayerNotification");

// Get all player notifications (paginated)
router.get("/player/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 30 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [notifications, total, unreadCount] = await Promise.all([
      PlayerNotification.find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      PlayerNotification.countDocuments({ userId }),
      PlayerNotification.countDocuments({ userId, isRead: false }),
    ]);

    res.json({ success: true, notifications, total, unreadCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get unread count
router.get("/player/:userId/unread-count", async (req, res) => {
  try {
    const count = await PlayerNotification.countDocuments({
      userId: req.params.userId,
      isRead: false,
    });
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Mark single as read
router.put("/player/:notificationId/read", async (req, res) => {
  try {
    await PlayerNotification.findByIdAndUpdate(req.params.notificationId, { isRead: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Mark all as read
router.put("/player/:userId/read-all", async (req, res) => {
  try {
    await PlayerNotification.updateMany({ userId: req.params.userId, isRead: false }, { isRead: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
