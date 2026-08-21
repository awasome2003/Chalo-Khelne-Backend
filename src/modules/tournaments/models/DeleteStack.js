const mongoose = require("mongoose");

/**
 * DeleteStack — the manager's recycle bin for registrations.
 *
 * Nothing a manager deletes from the notifications inbox is destroyed. The
 * whole registration (the Booking, plus every manager Notification pointing at
 * it) is snapshotted into one entry here and only THEN removed from its own
 * collection, so a mis-click can be undone byte-for-byte.
 *
 * One entry = one (tournament, player) registration, not one document:
 *   • `bookings`      — the Booking doc(s) for that pair. Normally exactly one;
 *                       legacy duplicates (the unique index never built — see
 *                       scripts/dedupeBookings.js) can make it more.
 *   • `notifications` — every Notification row the inbox collapsed into that
 *                       single visible row.
 * Restoring re-inserts all of them together, so the manager gets back exactly
 * what they saw, not a half of it.
 *
 * Snapshots are stored as raw Mixed sub-documents on purpose: a restore must
 * reinstate the ORIGINAL document (same _id, same legacy fields), not a
 * re-validated approximation of it. Booking runs `strict: "throw"`, so a
 * legacy doc carrying a since-removed path (e.g. `selectedCategories`) could
 * not survive a round-trip through the schema.
 */
const DeleteStackSchema = new mongoose.Schema(
  {
    // "registration" = a booking (with any notifications attached to it).
    // "notification" = an inbox row whose booking no longer exists — the 48
    // orphan notifications the audit found. Deleting one clears the row only.
    entryType: {
      type: String,
      enum: ["registration", "notification"],
      required: true,
    },

    // Owning manager — every read is filtered on this, so one manager can
    // never see or restore another's bin.
    managerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Manager",
      required: true,
    },
    // Tenant key, copied from the deleted booking/tournament for reporting.
    clubId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
    },
    // Title AS IT WAS at delete time. The live tournament can be renamed (this
    // is exactly what left three inbox rows reading "SEP 12 & 13" against a
    // tournament since retitled "SEP 6TH"), and the bin must still describe
    // what the manager actually deleted.
    tournamentTitle: { type: String, default: null },

    // End date AS IT WAS at delete time — the clock the automatic purge runs
    // on. Snapshotted rather than looked up so the rule survives the
    // tournament being edited or deleted afterwards, and so the purge is one
    // indexed query instead of a join per entry.
    //
    // null means the end date could not be read (the tournament was already
    // gone when the entry was made). Those entries are NEVER purged
    // automatically — a rule that cannot be evaluated must not decide to
    // destroy something. They are cleared by hand from the bin instead.
    tournamentEndDate: { type: Date, default: null },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    userName: { type: String, default: null },

    bookings: { type: [mongoose.Schema.Types.Mixed], default: [] },
    notifications: { type: [mongoose.Schema.Types.Mixed], default: [] },

    // Free-text note the manager may attach when deleting ("duplicate entry",
    // "paid at venue instead", …).
    reason: { type: String, trim: true, default: null },

    status: {
      type: String,
      enum: ["deleted", "restored"],
      default: "deleted",
    },

    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Manager",
      required: true,
    },
    deletedAt: { type: Date, default: Date.now },
    restoredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Manager",
      default: null,
    },
    restoredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// The bin listing: this manager's entries, newest first, filtered by status.
DeleteStackSchema.index({ managerId: 1, status: 1, deletedAt: -1 });
// "was this registration ever deleted?" — used by the restore conflict check
// and by anyone auditing a tournament's roster.
DeleteStackSchema.index({ tournamentId: 1, userId: 1 });
// The automatic purge sweep: still-deleted entries whose tournament has ended.
DeleteStackSchema.index({ status: 1, tournamentEndDate: 1 });

module.exports = mongoose.model("DeleteStack", DeleteStackSchema);
