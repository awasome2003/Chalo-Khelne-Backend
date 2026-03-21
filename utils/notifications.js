// server/utils/notifications.js

const { Expo } = require("expo-server-sdk");
const expo = new Expo();

const sendPushNotification = async (expoPushToken, notification) => {
  try {
    if (!Expo.isExpoPushToken(expoPushToken)) {
      console.error(`Invalid Expo Push Token: ${expoPushToken}`);
      return;
    }

    const message = {
      to: expoPushToken,
      sound: "default",
      title: notification.title,
      body: notification.body,
      data: notification.data || {},
      priority: "high",
      channelId: "match-reminders",
    };

    const chunks = expo.chunkPushNotifications([message]);

    for (let chunk of chunks) {
      try {
        await expo.sendPushNotificationsAsync(chunk);
      } catch (error) {
        console.error("Error sending push notification:", error);
      }
    }
  } catch (error) {
    console.error("Error in sendPushNotification:", error);
  }
};

module.exports = {
  sendPushNotification,
};
