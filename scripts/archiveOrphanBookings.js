/**
 * Archive orphan bookings (Phase 1.1 data hygiene) — REVERSIBLE cleanup.
 *
 * An orphan = a booking whose tournament no longer exists (the parent tournament
 * was deleted but the booking remained). These cannot be tenant-assigned and
 * clutter the main collection.
 *
 * This script:
 *   1) Copies each orphan (full document, original _id preserved) into the
 *      `bookings_archive` collection, tagged with archivedAt + reason.
 *   2) Only after confirming the archive count matches, removes them from the
 *      main `bookings` collection.
 *
 * Reversible: to restore, copy a doc from bookings_archive back into bookings.
 *
 * Usage:
 *   node scripts/archiveOrphanBookings.js --dry-run   # report only, no writes
 *   node scripts/archiveOrphanBookings.js             # archive + remove
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Booking = require("../src/modules/tournaments/models/BookingModel");
const Tournament = require("../src/modules/tournaments/models/Tournament");

const DRY_RUN = process.argv.includes("--dry-run");
const ARCHIVE_COLLECTION = "bookings_archive";

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set.");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected${DRY_RUN ? " (DRY RUN — no writes)" : ""}`);

  // Existing tournament ids (as strings) — robust to ObjectId/string storage.
  const tours = await Tournament.find({}).select("_id").lean();
  const existing = new Set(tours.map((t) => String(t._id)));
  console.log(`Existing tournaments: ${existing.size}`);

  // Orphans = bookings whose tournamentId is not among existing tournaments.
  const all = await Booking.find({}).lean();
  const orphans = all.filter((b) => !existing.has(String(b.tournamentId)));
  console.log(`Total bookings: ${all.length} | orphan bookings (tournament deleted): ${orphans.length}`);

  if (orphans.length === 0) {
    console.log("Nothing to archive.");
    await mongoose.disconnect();
    process.exit(0);
  }

  const withClub = orphans.filter((o) => o.clubId).length;
  console.log(`  orphans that have a clubId set: ${withClub} (expected 0)`);

  if (DRY_RUN) {
    orphans.slice(0, 10).forEach((o) =>
      console.log(`   would archive booking ${o._id} → tournament ${o.tournamentId} [${o.status}]`)
    );
    console.log(`\nDRY RUN — would archive ${orphans.length} booking(s) into "${ARCHIVE_COLLECTION}", then remove them from "bookings". No writes made.`);
    await mongoose.disconnect();
    process.exit(0);
  }

  const now = new Date();
  const archiveDocs = orphans.map((o) => ({
    ...o,
    archivedAt: now,
    archivedReason: "orphan: parent tournament deleted",
    originalCollection: "bookings",
  }));

  // 1) Insert into archive collection (preserves original _id → restorable).
  const archiveCol = mongoose.connection.collection(ARCHIVE_COLLECTION);
  let inserted = 0;
  try {
    const res = await archiveCol.insertMany(archiveDocs, { ordered: false });
    inserted = res.insertedCount;
  } catch (err) {
    console.error(`ABORT: archive insert failed (${err.message}). NOTHING was deleted.`);
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`Archived ${inserted} booking(s) into "${ARCHIVE_COLLECTION}".`);

  if (inserted !== orphans.length) {
    console.error(`ABORT: archived ${inserted} but expected ${orphans.length}. NOTHING was deleted from bookings.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  // 2) Remove from main collection by _id.
  const ids = orphans.map((o) => o._id);
  const del = await Booking.deleteMany({ _id: { $in: ids } });
  console.log(`Removed ${del.deletedCount} orphan booking(s) from "bookings".`);

  // 3) Post-checks.
  const remainingNullClub = await Booking.countDocuments({
    $or: [{ clubId: null }, { clubId: { $exists: false } }],
  });
  const remainingTotal = await Booking.countDocuments({});
  console.log(`\nDone. bookings now=${remainingTotal} | bookings with no clubId=${remainingNullClub} (expect 0)`);
  console.log(`Archive "${ARCHIVE_COLLECTION}" holds ${inserted} removed record(s) — restorable.`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("Archive failed:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
