/**
 * Planner reminder cron — polls PlannerNote every minute for notes whose
 * reminder window has arrived and dispatches an Expo push notification to
 * each of the owner's active device tokens.
 */

const cron = require("node-cron");
const { Expo } = require("expo-server-sdk");
const PlannerNote = require("../src/modules/social/models/PlannerNote");
const DeviceToken = require("../src/modules/identity/models/DeviceToken");

const expo = new Expo();

async function sendPushToTokens(tokens, payload) {
  const messages = tokens
    .filter((t) => Expo.isExpoPushToken(t))
    .map((to) => ({
      to,
      sound: "default",
      title: payload.title,
      body: payload.body,
      data: payload.data || {},
      priority: "high",
      channelId: "planner-reminders",
      _displayInForeground: true,
    }));

  if (messages.length === 0) return [];

  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];
  for (const chunk of chunks) {
    try {
      const sent = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...sent);
    } catch (err) {
      console.error("[plannerReminderCron] push chunk failed:", err);
    }
  }
  return tickets;
}

async function processDueReminders() {
  const now = new Date();
  let due;
  try {
    due = await PlannerNote.find({
      reminder: true,
      reminderProcessed: false,
      reminderAt: { $ne: null, $lte: now },
    }).limit(200);
  } catch (err) {
    console.error("[plannerReminderCron] query failed:", err);
    return;
  }

  if (!due.length) return;
  console.log(`[plannerReminderCron] processing ${due.length} due reminders`);

  for (const note of due) {
    try {
      const tokens = await DeviceToken.find({
        userId: note.userId,
        isActive: true,
        allowNotifications: true,
      })
        .select("token")
        .lean();

      const tokenStrings = tokens.map((t) => t.token).filter(Boolean);

      if (tokenStrings.length > 0) {
        await sendPushToTokens(tokenStrings, {
          title: note.title || "Planner reminder",
          body: note.time ? `Scheduled for ${note.time}` : "You have an upcoming activity",
          data: { noteId: String(note._id), type: "planner-reminder" },
        });
      } else {
        console.log(
          `[plannerReminderCron] note ${note._id}: no active device tokens for user ${note.userId}`
        );
      }

      note.reminderProcessed = true;
      note.reminderSentAt = new Date();
      await note.save();
    } catch (err) {
      console.error(`[plannerReminderCron] failed for note ${note._id}:`, err);
    }
  }
}

function startPlannerReminderCron() {
  cron.schedule("* * * * *", () => {
    processDueReminders().catch((err) =>
      console.error("[plannerReminderCron] tick failed:", err)
    );
  });
  console.log("[plannerReminderCron] scheduled (every minute)");
}

module.exports = { startPlannerReminderCron, processDueReminders };
