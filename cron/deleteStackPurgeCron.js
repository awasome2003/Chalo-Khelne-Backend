/**
 * Delete-stack purge cron — empties a manager's recycle bin once the
 * tournament an entry belongs to is over.
 *
 * The bin exists so a mis-clicked delete can be undone. That safety net is only
 * needed while the tournament is live: once it has finished, nobody is going to
 * restore a registration into it, and the snapshots (full bookings, rosters,
 * every notification) would otherwise sit there forever. A manager who clears
 * their own bin is fine; this is for the ones who don't.
 *
 * The rule is deliberately narrow:
 *
 *   status === "deleted"  AND  tournamentEndDate < now
 *
 *  • Only "deleted" entries. A restored entry is a record of something that
 *    was put back; the documents are live again and the entry is history.
 *
 *  • Only entries with a KNOWN end date. tournamentEndDate is snapshotted when
 *    the entry is written (end of the tournament's last day), so a tournament
 *    renamed, re-dated or deleted afterwards cannot move the deadline. When it
 *    is null — the tournament was already gone at delete time — the rule
 *    cannot be evaluated, and an automatic process that destroys things must
 *    not guess. Those entries stay until a manager purges them by hand.
 *
 * The whole purge is one indexed deleteMany on {status, tournamentEndDate}.
 */

const cron = require("node-cron");
const DeleteStack = require("../src/modules/tournaments/models/DeleteStack");

/**
 * Delete every bin entry whose tournament has ended.
 * @param {Date} [now] injectable clock — tests pass a fixed instant.
 * @returns {Promise<number>} how many entries were removed.
 */
async function purgeEndedDeleteStackEntries(now = new Date()) {
  try {
    const result = await DeleteStack.deleteMany({
      status: "deleted",
      tournamentEndDate: { $ne: null, $lt: now },
    });

    if (result.deletedCount) {
      console.log(
        `[deleteStackPurgeCron] purged ${result.deletedCount} delete-stack entr(ies) for finished tournaments`
      );
    }
    return result.deletedCount;
  } catch (err) {
    console.error("[deleteStackPurgeCron] purge failed:", err.message);
    return 0;
  }
}

function startDeleteStackPurgeCron() {
  // Daily at 03:15. The deadline is a whole day (23:59:59.999 of the
  // tournament's last date), so a nightly sweep is as timely as the rule can
  // be — running it more often would only re-scan the same empty result.
  cron.schedule("15 3 * * *", () => {
    purgeEndedDeleteStackEntries().catch((err) =>
      console.error("[deleteStackPurgeCron] tick failed:", err)
    );
  });
  console.log("[deleteStackPurgeCron] scheduled (daily 03:15)");
}

module.exports = { startDeleteStackPurgeCron, purgeEndedDeleteStackEntries };
