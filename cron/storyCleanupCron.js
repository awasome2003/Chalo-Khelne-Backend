/**
 * Story cleanup cron — hard-deletes Story documents older than 7 days and
 * removes their backing image files from disk. The 24-hour visibility window
 * is handled at query time in storyController.getStoriesFeed; this job is
 * only about reclaiming storage.
 */

const cron = require("node-cron");
const path = require("path");
const fs = require("fs");
const Story = require("../src/modules/social/models/Story");
const { storiesDir } = require("../middleware/uploads");

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

async function purgeExpiredStories() {
  const cutoff = new Date(Date.now() - SEVEN_DAYS_MS);
  let expired;
  try {
    expired = await Story.find({ createdAt: { $lt: cutoff } }).limit(500);
  } catch (err) {
    console.error("[storyCleanupCron] query failed:", err);
    return;
  }

  if (!expired.length) return;
  console.log(`[storyCleanupCron] purging ${expired.length} expired stories`);

  for (const story of expired) {
    try {
      if (story.type === "image" && story.image) {
        const absolute = path.join(storiesDir, "..", story.image);
        if (fs.existsSync(absolute)) {
          try {
            await fs.promises.unlink(absolute);
          } catch (e) {
            console.warn(
              `[storyCleanupCron] failed to unlink ${absolute}: ${e.message}`
            );
          }
        }
      }
      await story.deleteOne();
    } catch (err) {
      console.error(
        `[storyCleanupCron] failed to delete story ${story._id}:`,
        err
      );
    }
  }
}

function startStoryCleanupCron() {
  // Run hourly. The actual cutoff is 7 days; hourly cadence keeps the queue
  // small without thrashing the DB.
  cron.schedule("0 * * * *", () => {
    purgeExpiredStories().catch((err) =>
      console.error("[storyCleanupCron] tick failed:", err)
    );
  });
  console.log("[storyCleanupCron] scheduled (hourly)");
}

module.exports = { startStoryCleanupCron, purgeExpiredStories };
