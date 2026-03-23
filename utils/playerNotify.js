/**
 * Unified Player Notification Utility
 *
 * Saves notification to DB + emits socket event + sends Expo push.
 *
 * Usage:
 *   const { notifyPlayer, notifyPlayers } = require("../utils/playerNotify");
 *
 *   // Single player
 *   await notifyPlayer(req.app, userId, {
 *     type: "tournament_new",
 *     title: "New Tournament",
 *     message: "Badminton Open 2026 is now open for registration!",
 *     data: { tournamentId: "...", tournamentName: "..." }
 *   });
 *
 *   // Multiple players
 *   await notifyPlayers(req.app, [userId1, userId2], { ... });
 */

const PlayerNotification = require("../Modal/PlayerNotification");
const User = require("../Modal/User");

async function notifyPlayer(app, userId, notification) {
  try {
    // 1. Save to DB
    const saved = await PlayerNotification.create({
      userId,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      data: notification.data || {},
    });

    // 2. Emit socket event (real-time if user is online)
    const io = app.get("io");
    if (io) {
      io.to(`user_${userId}`).emit("notification:new", {
        _id: saved._id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        data: notification.data || {},
        createdAt: saved.createdAt,
      });
    }

    // 3. Send Expo push notification (for background/closed app)
    try {
      const user = await User.findById(userId).select("expoPushToken").lean();
      if (user?.expoPushToken) {
        const { Expo } = require("expo-server-sdk");
        const expo = new Expo();
        if (Expo.isExpoPushToken(user.expoPushToken)) {
          await expo.sendPushNotificationsAsync([{
            to: user.expoPushToken,
            title: notification.title,
            body: notification.message,
            data: { type: notification.type, ...notification.data },
            sound: "default",
          }]);
        }
      }
    } catch (pushErr) {
      // Silent fail — push is not critical
    }

    return saved;
  } catch (err) {
    console.error(`[PLAYER_NOTIFY] Error for user ${userId}:`, err.message);
    return null;
  }
}

async function notifyPlayers(app, userIds, notification) {
  const results = [];
  for (const userId of userIds) {
    const result = await notifyPlayer(app, userId, notification);
    if (result) results.push(result);
  }
  return results;
}

module.exports = { notifyPlayer, notifyPlayers };
