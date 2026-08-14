const cron = require("node-cron");
const Notification = require("../src/modules/social/models/Notification_Player");

// The real implementation lives in utils/notifications.js.
//
// This used to be `require("../controllers/matchController")`, which does NOT
// export sendPushNotification — it never has. The import resolved to
// `undefined`, so the very first reminder with a push token threw
// "sendPushNotification is not a function", the rejection escaped the
// cron.schedule callback, and the tick died before marking anything processed.
//
// The consequence is larger than the two defects §3.3 describes: the
// match-reminder cron has never delivered a single push notification, and the
// backlog it failed to drain included the tokenful rows too, not just the
// tokenless ones.
const notifications = require("../utils/notifications");

/**
 * Match-reminder push cron.
 *
 * §3.3 — two defects in the original eleven lines:
 *
 *   1. A notification with no pushToken was NEVER marked processed. It failed
 *      the `if (notification.pushToken)`, fell out of the loop untouched, and
 *      was re-selected by every subsequent run. The backlog only grew: after a
 *      few months of tokenless rows the query was scanning all of them sixty
 *      times an hour, forever.
 *
 *   2. The run was serial and unbounded with no overlap guard. Expo's push
 *      endpoint under load, or a queue of a few thousand reminders, takes
 *      longer than sixty seconds; node-cron then started the next tick while
 *      the first was still awaiting. Both ticks selected the same rows, because
 *      isProcessed was only written after the send returned — so players got
 *      the same match reminder two or three times.
 *
 * The shape now: claim each row with an atomic findOneAndUpdate BEFORE sending,
 * bound the batch, mark tokenless rows processed with a reason, and refuse to
 * re-enter while a tick is still running.
 */

// How many reminders one tick will process. Bounds both the query and the
// wall-clock of a single run; the leftovers are picked up next minute.
const BATCH_LIMIT = 200;

// A claimed row that never reaches a terminal state (process killed mid-send)
// would otherwise stay claimed forever. Anything claimed longer ago than this
// is considered abandoned and becomes eligible again.
const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

// Re-entry guard. node-cron will happily start a second tick while the first is
// still awaiting; this makes that a no-op instead of a double-send.
let isRunning = false;

async function processDueNotifications() {
  if (isRunning) {
    console.warn("[Cron] Previous notification run still in progress — skipping this tick");
    return { skipped: true };
  }
  isRunning = true;

  const stats = { claimed: 0, sent: 0, skippedNoToken: 0, failed: 0 };

  try {
    const now = new Date();
    const abandonedBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);

    for (let i = 0; i < BATCH_LIMIT; i++) {
      // ── Claim-then-send ────────────────────────────────────────────────
      // The claim is the atomic step: findOneAndUpdate flips isProcessed as
      // part of the same operation that selects the row, so a concurrent tick
      // (or a second process, once this is no longer single-instance) cannot
      // pick up the same reminder. Reading first and writing after the send —
      // what this used to do — is exactly the window that caused duplicates.
      const notification = await Notification.findOneAndUpdate(
        {
          isProcessed: false,
          reminderTime: { $lte: now },
          $or: [
            { claimedAt: { $exists: false } },
            { claimedAt: null },
            { claimedAt: { $lt: abandonedBefore } },
          ],
        },
        { $set: { isProcessed: true, claimedAt: now } },
        { new: true, sort: { reminderTime: 1 } }
      );

      if (!notification) break; // queue drained
      stats.claimed++;

      // Tokenless rows reach a TERMINAL state instead of being skipped. This is
      // the fix for the backlog that never drained.
      if (!notification.pushToken) {
        notification.processedReason = "no_push_token";
        notification.sentAt = null;
        await notification.save();
        stats.skippedNoToken++;
        continue;
      }

      try {
        // Called through the module object (not a destructured binding) so a
        // test spy on utils/notifications is observed, and so a future rename
        // fails loudly at the call rather than silently binding undefined.
        await notifications.sendPushNotification(notification.pushToken, {
          to: notification.pushToken,
          sound: "default",
          title: `Match Reminder - ${notification.minutesBefore} minutes`,
          body: `Your match is starting in ${notification.minutesBefore} minutes`,
          data: { matchId: notification.matchId },
          badge: 1,
          priority: "high",
        });

        notification.sentAt = new Date();
        notification.processedReason = "sent";
        await notification.save();
        stats.sent++;
      } catch (err) {
        // The row stays claimed (isProcessed: true) so a failing token cannot
        // wedge the queue. Record why, so a failure is visible rather than
        // looking like a successful send.
        notification.processedReason = `send_failed: ${err.message}`.slice(0, 500);
        notification.sentAt = null;
        await notification.save();
        stats.failed++;
        console.error(
          `[Cron] Push failed for match ${notification.matchId}:`,
          err.message
        );
      }
    }

    if (stats.claimed > 0) {
      console.log(
        `[Cron] Notifications — claimed ${stats.claimed}, sent ${stats.sent}, ` +
          `no-token ${stats.skippedNoToken}, failed ${stats.failed}`
      );
    }
    return stats;
  } catch (err) {
    // A throw here must not kill the scheduler.
    console.error("[Cron] Notification run errored:", err);
    return { ...stats, error: err.message };
  } finally {
    isRunning = false;
  }
}

const startNotificationCron = () => {
  cron.schedule("* * * * *", processDueNotifications);
};

module.exports = startNotificationCron;
// Exported for tests and for a manual drain.
module.exports.processDueNotifications = processDueNotifications;
