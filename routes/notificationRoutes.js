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

module.exports = router;
