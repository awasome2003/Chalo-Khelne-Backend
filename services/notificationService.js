const { Expo } = require("expo-server-sdk");
const User = require("../Modal/User");
const { Manager } = require("../Modal/ClubManager");
const DeviceToken = require("../Modal/DeviceToken");

class NotificationService {
  constructor() {
    this.expo = new Expo();
    this.IST_OFFSET = 330; // 5.5 hours in minutes
  }

  toLocalTime(utcDate) {
    const date = new Date(utcDate);
    return new Date(date.getTime() + this.IST_OFFSET * 60000);
  }

  fromLocalTime(localDate) {
    return new Date(localDate.getTime() - this.IST_OFFSET * 60000);
  }

  async registerPushToken(userId, expoPushToken, isManager = false) {
    try {
      console.log(
        `[TOKEN_REGISTER] Registering token for ${
          isManager ? "manager" : "user"
        } ${userId}`
      );

      if (!Expo.isExpoPushToken(expoPushToken)) {
        console.error("[TOKEN_REGISTER] Invalid token format:", expoPushToken);
        return;
      }

      const Model = isManager ? Manager : User;
      const user = await Model.findById(userId);

      if (!user) {
        console.error("[TOKEN_REGISTER] User/Manager not found");
        return;
      }

      // Initialize pushTokens array if it doesn't exist
      if (!user.pushTokens) {
        user.pushTokens = [];
      }

      // Check if token already exists
      const tokenExists = user.pushTokens.some(
        (t) => t.token === expoPushToken
      );

      if (!tokenExists) {
        user.pushTokens.push({
          token: expoPushToken,
          createdAt: new Date(),
        });
        await user.save();
        console.log("[TOKEN_REGISTER] Token registered successfully");
      } else {
        console.log("[TOKEN_REGISTER] Token already exists");
      }
    } catch (error) {
      console.error("[TOKEN_REGISTER] Error:", error);
    }
  }

  async scheduleMatchReminders(match, minutes) {
    try {
      const localMatchStart = this.toLocalTime(new Date(match.startTime));
      const localNotifyTime = new Date(localMatchStart);
      localNotifyTime.setMinutes(localNotifyTime.getMinutes() - minutes);
      const localNow = this.toLocalTime(new Date());

      console.log(
        `[SCHEDULE] ${minutes}min reminder for Match ${match.matchNumber}:`,
        {
          matchStart: localMatchStart.toLocaleString("en-IN"),
          notifyAt: localNotifyTime.toLocaleString("en-IN"),
          currentTime: localNow.toLocaleString("en-IN"),
        }
      );

      const timeUntilNotification =
        localNotifyTime.getTime() - localNow.getTime();

      if (timeUntilNotification <= 0) {
        return; // Skip if notification time has passed
      }

      // Use a global Map to track scheduled notifications
      if (!this.scheduledNotifications) {
        this.scheduledNotifications = new Map();
      }

      const notificationKey = `${match._id}_${minutes}`;
      if (this.scheduledNotifications.has(notificationKey)) {
        console.log(
          `[SCHEDULE] Notification already scheduled for Match ${match.matchNumber}`
        );
        return;
      }

      this.scheduledNotifications.set(notificationKey, true);

      setTimeout(async () => {
        await this.sendMatchNotification(match, minutes);
        this.scheduledNotifications.delete(notificationKey);
      }, timeUntilNotification);
    } catch (error) {
      console.error(`[SCHEDULE] Error:`, error);
    }
  }

  async sendMatchNotification(match, minutes) {
    try {
      // Get device tokens for all users with active notifications
      const deviceTokens = await DeviceToken.find({
        isActive: true,
        allowNotifications: true, // using the new field instead of isManager
      }).sort({ createdAt: -1 });

      console.log("[DEBUG] Found device tokens:", deviceTokens.length);

      if (!deviceTokens.length) {
        console.log("[NOTIFICATION] No active device tokens found");
        return;
      }

      const messages = deviceTokens.map((deviceToken) => ({
        to: deviceToken.token,
        sound: "default",
        title: `🏓 Match in ${minutes} minutes`,
        body: `${match.player1.userName} vs ${match.player2.userName}\nCourt ${match.courtNumber}`,
        data: { matchId: match._id.toString() },
        priority: "high",
        channelId: "match-reminders",
        _displayInForeground: true,
        android: {
          channelId: "match-reminders",
          priority: "max",
          vibrate: [0, 250, 250, 250],
          sound: true,
          importance: "max",
          sticky: false,
          visibility: "public",
          allowWhileIdle: true,
          showWhen: true,
          icon: "../assets/sportapp_logo",
        },
        ios: {
          sound: true,
          _displayInForeground: true,
          priority: 10,
          contentAvailable: true,
        },
      }));

      const tickets = await this.expo.sendPushNotificationsAsync(messages);
      console.log("[SEND] Notifications sent:", tickets);
    } catch (error) {
      console.error("[NOTIFICATION] Error:", error);
    }
  }

  async handleReceipts(tickets) {
    try {
      const receiptIds = tickets
        .filter((ticket) => ticket.id)
        .map((ticket) => ticket.id);
      const receiptChunks =
        this.expo.chunkPushNotificationReceiptIds(receiptIds);

      for (let chunk of receiptChunks) {
        const receipts = await this.expo.getPushNotificationReceiptsAsync(
          chunk
        );
        console.log("[RECEIPTS] Delivery receipts:", receipts);

        for (const [id, receipt] of Object.entries(receipts)) {
          if (receipt.status === "ok") {
            console.log(
              `[RECEIPT_SUCCESS] Notification ${id} delivered successfully`
            );
          } else if (receipt.status === "error") {
            console.error(
              `[RECEIPT_ERROR] Notification ${id} failed:`,
              receipt.message
            );
            if (receipt.details?.error === "DeviceNotRegistered") {
              // Handle invalid token cleanup
              console.log(
                `[TOKEN_CLEANUP] Token needs to be removed for receipt ${id}`
              );
            }
          }
        }
      }
    } catch (error) {
      console.error("[RECEIPT_ERROR] Failed to check receipts:", error);
    }
  }

  async updateDeviceToken(userId, token, isManager = false) {
    try {
      const update = {
        userId,
        token,
        isManager,
        isActive: true,
        lastUpdated: new Date(),
      };

      const options = {
        upsert: true, // Create if doesn't exist
        new: true, // Return updated document
        setDefaultsOnInsert: true,
      };

      const result = await DeviceToken.findOneAndUpdate(
        { token }, // Find by token
        update,
        options
      );

      // Deactivate other tokens for this user
      await DeviceToken.updateMany(
        {
          userId,
          token: { $ne: token },
          isManager,
        },
        {
          isActive: false,
          lastUpdated: new Date(),
        }
      );

      return result;
    } catch (error) {
      console.error("[TOKEN_UPDATE] Error:", error);
      throw error;
    }
  }

  async getActiveTokensForUser(userId) {
    try {
      return await DeviceToken.find({
        userId,
        isActive: true,
      }).sort({ lastUpdated: -1 });
    } catch (error) {
      console.error("[TOKEN_FETCH] Error:", error);
      throw error;
    }
  }
}

module.exports = new NotificationService();
