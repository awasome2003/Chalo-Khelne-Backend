const mongoose = require("mongoose");
const Booking = require("../src/modules/tournaments/models/BookingModel");
const Notification = require("../src/modules/social/models/Notification");
const Tournament = require("../src/modules/tournaments/models/Tournament");
const DeleteStack = require("../src/modules/tournaments/models/DeleteStack");

// One request may not delete/restore more than this many registrations. A
// manager clearing an inbox works in tens; a four-figure batch is a script or a
// mistake, and either way it should not be one transaction.
const MAX_ITEMS = 200;

const idOf = (v) => String(v && v._id ? v._id : v || "");

/**
 * Bookings are read and written through the RAW collection here, deliberately.
 *
 * The Booking model runs tenantScope in enforce mode, which injects
 * `{ clubId: <caller's club> }` into every model-level query. 331 legacy
 * bookings carry no clubId at all, so a model query would silently skip them:
 * the snapshot would be written and the booking would survive. Authorisation
 * for this controller is the stricter check anyway — the caller must manage the
 * TOURNAMENT, verified explicitly in actionableTournaments() before anything is
 * read — so the club-level filter adds nothing here but a failure mode.
 *
 * The raw handle is also what makes restore exact: the original _id and any
 * legacy fields go back untouched, with no `strict: "throw"` schema in the way.
 */
const bookingsRaw = () => Booking.collection;

/**
 * Resolve which of `ids` this manager may act on, and how we know.
 *
 * Returns a Map(id -> {title, clubId, tournamentMissing}). An id absent from
 * the map is one the caller may not touch.
 *
 * Two ways to qualify:
 *
 *  • The tournament exists and lists the caller in managerId. The normal case.
 *
 *  • The tournament is GONE but a notification for it was addressed to this
 *    manager. 16 of the 21 tournaments in one live inbox no longer exist —
 *    deleted tournaments leave their notification rows behind forever, and
 *    those rows are precisely the ones a manager wants to clear. A deleted
 *    tournament cannot answer "is this yours?", so the notification answers it
 *    instead: it names the manager it was sent to. Without this, clearing dead
 *    rows would 403 on a document nobody can produce.
 */
async function actionableTournaments(ids, callerId) {
  if (!ids.length) return new Map();
  const rows = await Tournament.find({ _id: { $in: ids } })
    .select("_id title managerId clubId endDate")
    .lean();

  const allowed = new Map();
  const existing = new Set(rows.map((t) => String(t._id)));
  for (const t of rows) {
    const managers = Array.isArray(t.managerId) ? t.managerId : [t.managerId];
    if (managers.some((m) => String(m) === callerId)) {
      allowed.set(String(t._id), {
        title: t.title || null,
        clubId: t.clubId || null,
        // endDate is stored as a plain "YYYY-MM-DD" string on some documents
        // and a Date on others; normalise once, here, so the purge only ever
        // compares Dates. An unparseable value becomes null, which means
        // "never auto-purge" rather than "purge at epoch".
        endDate: parseEndDate(t.endDate),
        tournamentMissing: false,
      });
    }
  }

  const vanished = ids.filter((id) => !existing.has(String(id)));
  if (vanished.length) {
    const mine = await Notification.find({
      tournamentId: { $in: vanished },
      managerId: callerId,
    })
      .select("tournamentId message")
      .lean();
    for (const n of mine) {
      const id = String(n.tournamentId);
      if (allowed.has(id)) continue;
      // The tournament's own title died with it; the message kept a copy.
      const quoted = /registered for "([^"]+)"/.exec(n.message || "");
      allowed.set(id, {
        title: quoted ? quoted[1] : null,
        clubId: null,
        // The tournament is gone, so there is no end date to purge against.
        endDate: null,
        tournamentMissing: true,
      });
    }
  }

  return allowed;
}

/**
 * Tournament.endDate -> the instant that day is over, or null.
 *
 * The field is a Date on some documents and a "YYYY-MM-DD" string on others
 * (the live SEP 6TH tournament stores the string form), so it is normalised on
 * the way into the delete stack. The returned instant is the END of the day,
 * matching what the manager's inbox already calls "expired" — a tournament is
 * not over at midnight of the day it finishes.
 */
function parseEndDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Normalise + de-duplicate the (tournamentId, userId) pairs in the request. */
function parseItems(items) {
  const pairs = new Map();
  for (const it of items) {
    const tournamentId = idOf(it && it.tournamentId);
    const userId = idOf(it && it.userId);
    if (!mongoose.isValidObjectId(tournamentId) || !mongoose.isValidObjectId(userId)) continue;
    pairs.set(`${tournamentId}|${userId}`, { tournamentId, userId });
  }
  return [...pairs.values()];
}

const bookingTrashController = {
  /**
   * POST /api/payments/booking/delete
   * body: { items: [{ tournamentId, userId }], reason? }
   *
   * Moves each registration into the manager's delete stack: the Booking and
   * every Notification for that (tournament, player) pair are snapshotted into
   * one DeleteStack entry and only then removed. Both halves run in a
   * transaction, so a registration can never be half-deleted — a booking with
   * no inbox row is the exact failure this screen already suffers from.
   */
  deleteRegistrations: async (req, res) => {
    try {
      const { items, reason } = req.body || {};
      const callerId = String(req.user?.id || req.user?._id || "");

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, message: "No registrations provided" });
      }
      if (items.length > MAX_ITEMS) {
        return res.status(400).json({
          success: false,
          message: `Too many registrations in one request (max ${MAX_ITEMS})`,
        });
      }

      const pairs = parseItems(items);
      if (!pairs.length) {
        return res.status(400).json({ success: false, message: "Invalid tournamentId or userId" });
      }

      const owned = await actionableTournaments(
        [...new Set(pairs.map((p) => p.tournamentId))],
        callerId
      );
      // Ownership is all-or-nothing, matching bulkUpdateBookingStatus: a batch
      // reaching into someone else's tournament is a bug in the caller, not a
      // partial success to be papered over.
      if (pairs.some((p) => !owned.has(p.tournamentId))) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: one or more tournaments are not yours",
        });
      }

      const entries = [];
      const skipped = [];

      for (const { tournamentId, userId } of pairs) {
        const tOid = new mongoose.Types.ObjectId(tournamentId);
        const uOid = new mongoose.Types.ObjectId(userId);

        const meta = owned.get(tournamentId);
        // When the tournament is gone, the caller's authority came from their
        // OWN notification rows — so only those may be removed. A co-manager's
        // copy of the same dead row is not theirs to clear.
        const notificationFilter = meta.tournamentMissing
          ? { tournamentId: tOid, userId: uOid, managerId: callerId }
          : { tournamentId: tOid, userId: uOid };

        const [bookings, notifications] = await Promise.all([
          bookingsRaw().find({ tournamentId: tOid, userId: uOid }).toArray(),
          Notification.find(notificationFilter).lean(),
        ]);

        if (!bookings.length && !notifications.length) {
          skipped.push({ tournamentId, userId, reason: "Nothing found to delete" });
          continue;
        }

        const snapshot = {
          entryType: bookings.length ? "registration" : "notification",
          managerId: callerId,
          clubId: (bookings[0] && bookings[0].clubId) || meta.clubId || null,
          tournamentId: tOid,
          tournamentTitle: meta.title,
          tournamentEndDate: meta.endDate,
          userId: uOid,
          userName: (bookings[0] && bookings[0].userName) || null,
          bookings,
          notifications,
          reason: (reason || "").trim() || null,
          deletedBy: callerId,
          deletedAt: new Date(),
        };

        const bookingIds = bookings.map((b) => b._id);
        const notifIds = notifications.map((n) => n._id);

        const session = await mongoose.startSession();
        try {
          let entry;
          await session.withTransaction(async () => {
            const [created] = await DeleteStack.create([snapshot], { session });
            entry = created;
            if (bookingIds.length) {
              await bookingsRaw().deleteMany({ _id: { $in: bookingIds } }, { session });
            }
            if (notifIds.length) {
              await Notification.deleteMany({ _id: { $in: notifIds } }, { session });
            }
          });
          entries.push({
            entryId: entry._id,
            tournamentId,
            userId,
            userName: snapshot.userName,
            bookings: bookingIds.length,
            notifications: notifIds.length,
          });
        } catch (txErr) {
          console.error("[BOOKING_DELETE] transaction failed:", txErr.message);
          skipped.push({ tournamentId, userId, reason: "Delete failed — nothing was removed" });
        } finally {
          session.endSession();
        }
      }

      return res.json({
        success: true,
        message: `${entries.length} registration(s) moved to the delete stack`,
        deletedCount: entries.length,
        entries,
        skipped,
      });
    } catch (error) {
      console.error("[BOOKING_DELETE] Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to delete registrations",
        error: error.message,
      });
    }
  },

  /**
   * GET /api/payments/:managerId/trash?status=deleted&limit=100
   * The manager's own delete stack, newest first.
   */
  listDeleted: async (req, res) => {
    try {
      const { managerId } = req.params;
      const status = req.query.status === "restored" ? "restored" : "deleted";
      const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

      const entries = await DeleteStack.find({ managerId, status })
        .sort({ deletedAt: -1 })
        .limit(limit)
        .lean();

      // The snapshots can be large (team rosters, sportSelections). The bin
      // only needs to describe what each entry holds — the documents
      // themselves are never rendered, only restored.
      const summarised = entries.map((e) => {
        const booking = (e.bookings && e.bookings[0]) || null;
        const notification = (e.notifications && e.notifications[0]) || null;
        return {
          _id: e._id,
          entryType: e.entryType,
          tournamentId: e.tournamentId,
          tournamentTitle: e.tournamentTitle,
          userId: e.userId,
          userName: e.userName,
          reason: e.reason,
          status: e.status,
          deletedAt: e.deletedAt,
          restoredAt: e.restoredAt,
          // What the automatic sweep will do with this entry, and when. null =
          // it stays until someone clears it by hand.
          tournamentEndDate: e.tournamentEndDate || null,
          bookingCount: (e.bookings || []).length,
          notificationCount: (e.notifications || []).length,
          amount: booking ? booking.totalFee || booking.paymentAmount || 0 : 0,
          paymentMethod: (booking && booking.paymentMethod) || (notification && notification.paymentMethod) || null,
          bookingStatus: (booking && booking.status) || null,
          message: notification && notification.message,
        };
      });

      return res.json({ success: true, entries: summarised, total: summarised.length });
    } catch (error) {
      console.error("[BOOKING_TRASH_LIST] Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to load the delete stack",
        error: error.message,
      });
    }
  },

  /**
   * POST /api/payments/booking/restore
   * body: { entryIds: [DeleteStack._id] }
   *
   * Puts the snapshotted documents back exactly as they were. A pair that has
   * since been registered again is SKIPPED rather than restored — re-inserting
   * would hand the tournament two bookings for one player, which is the mess
   * scripts/dedupeBookings.js exists to clean up.
   */
  restoreEntries: async (req, res) => {
    try {
      const { entryIds } = req.body || {};
      const callerId = String(req.user?.id || req.user?._id || "");

      if (!Array.isArray(entryIds) || entryIds.length === 0) {
        return res.status(400).json({ success: false, message: "No entries provided" });
      }
      if (entryIds.length > MAX_ITEMS) {
        return res.status(400).json({
          success: false,
          message: `Too many entries in one request (max ${MAX_ITEMS})`,
        });
      }

      const valid = entryIds.filter((id) => mongoose.isValidObjectId(id));
      // Scoped to the caller's own bin — a manager cannot restore into a
      // tournament they do not run, and cannot name another manager's entry.
      const entries = await DeleteStack.find({
        _id: { $in: valid },
        managerId: callerId,
        status: "deleted",
      });

      const restored = [];
      const skipped = [];
      const found = new Set(entries.map((e) => String(e._id)));
      for (const id of entryIds) {
        if (!found.has(String(id))) {
          skipped.push({ entryId: id, reason: "Not in your delete stack" });
        }
      }

      for (const entry of entries) {
        const bookings = entry.bookings || [];
        const notifications = entry.notifications || [];

        // Re-registered since deletion? Leave the live booking alone.
        if (entry.userId) {
          const live = await bookingsRaw().findOne({
            tournamentId: entry.tournamentId,
            userId: entry.userId,
          });
          if (live) {
            skipped.push({
              entryId: entry._id,
              reason: "This player is registered again — restoring would duplicate the booking",
            });
            continue;
          }
        }

        const session = await mongoose.startSession();
        try {
          await session.withTransaction(async () => {
            if (bookings.length) {
              await bookingsRaw().insertMany(bookings, { session, ordered: false });
            }
            if (notifications.length) {
              await Notification.collection.insertMany(notifications, { session, ordered: false });
            }
            entry.status = "restored";
            entry.restoredBy = callerId;
            entry.restoredAt = new Date();
            await entry.save({ session });
          });
          restored.push({
            entryId: entry._id,
            tournamentId: entry.tournamentId,
            userId: entry.userId,
            userName: entry.userName,
            bookings: bookings.length,
            notifications: notifications.length,
          });
        } catch (txErr) {
          // 11000 means the document is already back (a double-tapped restore);
          // anything else is a real failure. Either way the entry stays in the
          // bin rather than being marked restored on a guess.
          console.error("[BOOKING_RESTORE] transaction failed:", txErr.message);
          skipped.push({
            entryId: entry._id,
            reason:
              txErr.code === 11000
                ? "Already restored"
                : "Restore failed — the entry is still in your delete stack",
          });
        } finally {
          session.endSession();
        }
      }

      return res.json({
        success: true,
        message: `${restored.length} registration(s) restored`,
        restoredCount: restored.length,
        restored,
        skipped,
      });
    } catch (error) {
      console.error("[BOOKING_RESTORE] Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to restore registrations",
        error: error.message,
      });
    }
  },

  /**
   * POST /api/payments/booking/purge
   * body: { entryIds: [DeleteStack._id] }
   *
   * Empties entries out of the bin for good. This is the ONE irreversible
   * action in the flow — after it, the snapshot is gone and the booking cannot
   * be brought back. The UI confirms it separately from delete, in those words.
   *
   * The automatic sweep (cron/deleteStackPurgeCron.js) does the same thing on a
   * schedule for tournaments that have finished; this is the manual door for a
   * manager who does not want to wait, or whose entry the sweep will never
   * touch (tournament already gone, so no end date to judge by).
   */
  purgeEntries: async (req, res) => {
    try {
      const { entryIds } = req.body || {};
      const callerId = String(req.user?.id || req.user?._id || "");

      if (!Array.isArray(entryIds) || entryIds.length === 0) {
        return res.status(400).json({ success: false, message: "No entries provided" });
      }
      if (entryIds.length > MAX_ITEMS) {
        return res.status(400).json({
          success: false,
          message: `Too many entries in one request (max ${MAX_ITEMS})`,
        });
      }

      const valid = entryIds.filter((id) => mongoose.isValidObjectId(id));
      // Scoped to the caller's own bin, exactly like restore.
      const result = await DeleteStack.deleteMany({
        _id: { $in: valid },
        managerId: callerId,
      });

      return res.json({
        success: true,
        message: `${result.deletedCount} entry(ies) permanently deleted`,
        purgedCount: result.deletedCount,
        skipped: entryIds.length - result.deletedCount,
      });
    } catch (error) {
      console.error("[BOOKING_PURGE] Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to permanently delete entries",
        error: error.message,
      });
    }
  },
};

module.exports = bookingTrashController;
module.exports.parseEndDate = parseEndDate;
