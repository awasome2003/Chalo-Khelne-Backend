const cron = require("node-cron");
const Notification = require("../Modal/Notification_Player");
const { sendPushNotification } = require("../controllers/matchController");

const startNotificationCron = () => {
  cron.schedule("* * * * *", async () => {
    const now = new Date();
    console.log("[Cron] Checking notifications at:", now);

    const pendingNotifications = await Notification.find({
      isProcessed: false,
      reminderTime: { $lte: now },
    });

    console.log(`Found ${pendingNotifications.length} pending notifications`);

    for (const notification of pendingNotifications) {
      if (notification.pushToken) {
        await sendPushNotification(notification.pushToken, {
          to: notification.pushToken,
          sound: "default",
          title: `Match Reminder - ${notification.minutesBefore} minutes`,
          body: `Your match is starting in ${notification.minutesBefore} minutes`,
          data: { matchId: notification.matchId },
          badge: 1,
          priority: "high",
        });

        notification.isProcessed = true;
        notification.sentAt = new Date();
        await notification.save();

        console.log(
          `Sent notification for match ${notification.matchId} to ${notification.userName}`
        );
      }
    }
  });
};

module.exports = startNotificationCron;
