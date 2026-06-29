/**
 * Archive orphan payments (Phase 1.1 data hygiene) — REVERSIBLE cleanup.
 *
 * An orphan = a payment whose tournament (eventId) no longer exists. These
 * cannot be tenant-assigned and clutter the main collection.
 *
 *   1) Copies each orphan (full document, original _id preserved) into the
 *      `payments_archive` collection, tagged with archivedAt + reason.
 *   2) Only after confirming the archive count matches, removes them from the
 *      main `payments` collection.
 *
 * Reversible: to restore, copy a doc from payments_archive back into payments.
 *
 * Usage:
 *   node scripts/archiveOrphanPayments.js --dry-run   # report only, no writes
 *   node scripts/archiveOrphanPayments.js             # archive + remove
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Payment = require("../src/modules/commerce/models/Payments");
const Tournament = require("../src/modules/tournaments/models/Tournament");

const DRY_RUN = process.argv.includes("--dry-run");
const ARCHIVE_COLLECTION = "payments_archive";

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

  // Orphans = payments whose eventId is not among existing tournaments.
  const all = await Payment.find({}).lean();
  const orphans = all.filter((p) => !existing.has(String(p.eventId)));
  console.log(`Total payments: ${all.length} | orphan payments (tournament deleted): ${orphans.length}`);

  if (orphans.length === 0) {
    console.log("Nothing to archive.");
    await mongoose.disconnect();
    process.exit(0);
  }

  const withClub = orphans.filter((o) => o.clubId).length;
  console.log(`  orphans that have a clubId set: ${withClub} (expected 0)`);

  if (DRY_RUN) {
    orphans.slice(0, 10).forEach((o) =>
      console.log(`   would archive payment ${o._id} → tournament ${o.eventId} [${o.status}]`)
    );
    console.log(`\nDRY RUN — would archive ${orphans.length} payment(s) into "${ARCHIVE_COLLECTION}", then remove them from "payments". No writes made.`);
    await mongoose.disconnect();
    process.exit(0);
  }

  const now = new Date();
  const archiveDocs = orphans.map((o) => ({
    ...o,
    archivedAt: now,
    archivedReason: "orphan: parent tournament deleted",
    originalCollection: "payments",
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
  console.log(`Archived ${inserted} payment(s) into "${ARCHIVE_COLLECTION}".`);

  if (inserted !== orphans.length) {
    console.error(`ABORT: archived ${inserted} but expected ${orphans.length}. NOTHING was deleted from payments.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  // 2) Remove from main collection by _id.
  const ids = orphans.map((o) => o._id);
  const del = await Payment.deleteMany({ _id: { $in: ids } });
  console.log(`Removed ${del.deletedCount} orphan payment(s) from "payments".`);

  // 3) Post-checks.
  const remainingNullClub = await Payment.countDocuments({
    $or: [{ clubId: null }, { clubId: { $exists: false } }],
  });
  const remainingTotal = await Payment.countDocuments({});
  console.log(`\nDone. payments now=${remainingTotal} | payments with no clubId=${remainingNullClub} (expect 0)`);
  console.log(`Archive "${ARCHIVE_COLLECTION}" holds ${inserted} removed record(s) — restorable.`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("Archive failed:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
