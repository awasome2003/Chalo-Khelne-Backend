"use strict";
const { startPlannerReminderCron } = require("./plannerReminderCron");
const { startStoryCleanupCron } = require("./storyCleanupCron");
const startNotificationCron = require("./notificationCron");

/**
 * Start all scheduled background jobs. MUST run in exactly ONE process.
 *
 * Single-instance (default): the web process runs these (RUN_CRON unset/true).
 * Multi-instance (Phase 2 HA): set RUN_CRON=false on every web instance and run
 * worker.js as the ONE dedicated cron owner — otherwise each web instance fires
 * the same jobs and double-sends notifications.
 */
function startAllCrons() {
  const jobs = [
    ["planner-reminder", startPlannerReminderCron],
    ["story-cleanup", startStoryCleanupCron],
    ["notification", startNotificationCron],
  ];
  for (const [name, start] of jobs) {
    try {
      start();
      console.log(`[cron] started: ${name}`);
    } catch (err) {
      console.error(`[cron] failed to start ${name}:`, err.message);
    }
  }
}

module.exports = { startAllCrons };
