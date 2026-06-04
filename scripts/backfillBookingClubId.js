/**
 * Backfill Booking.clubId (Phase 1.1 multi-tenancy).
 *
 * A booking's tenant = its tournament's tenant: Booking.tournamentId →
 * Tournament.clubId. Tournament.clubId must already be backfilled (it is, as of
 * the Tournament slice). Idempotent — only touches bookings without a clubId.
 *
 * Efficient strategy: for each tournament that has a clubId, updateMany its
 * not-yet-stamped bookings in one call (few tournaments, many bookings).
 *
 * Usage:
 *   node scripts/backfillBookingClubId.js            # apply
 *   node scripts/backfillBookingClubId.js --dry-run  # report only, no writes
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Booking = require("../Modal/BookingModel");
const Tournament = require("../Modal/Tournament");

const DRY_RUN = process.argv.includes("--dry-run");
const MISSING = { $or: [{ clubId: null }, { clubId: { $exists: false } }] };

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set.");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected to MongoDB${DRY_RUN ? " (DRY RUN — no writes)" : ""}`);

  const tournaments = await Tournament.find({ clubId: { $ne: null } })
    .select("_id clubId")
    .lean();
  console.log(`Found ${tournaments.length} tournament(s) with a clubId.`);

  let updated = 0;
  for (const t of tournaments) {
    const filter = { tournamentId: t._id, ...MISSING };
    if (DRY_RUN) {
      updated += await Booking.countDocuments(filter);
    } else {
      const r = await Booking.updateMany(filter, { $set: { clubId: t.clubId } });
      updated += r.modifiedCount || 0;
    }
  }

  // Bookings still missing a clubId = their tournament has no clubId or is gone.
  const skipped = await Booking.countDocuments(MISSING) - (DRY_RUN ? updated : 0);

  console.log(`\nDone. ${DRY_RUN ? "would update" : "updated"}=${updated}  still-missing=${Math.max(0, skipped)}`);
  if (skipped > 0) {
    console.warn(`\n⚠ ${skipped} booking(s) reference a tournament with no clubId (orphaned/legacy).`);
    const sample = await Booking.find(MISSING).select("_id tournamentId").limit(20).lean();
    sample.forEach((b) => console.warn(`   booking ${b._id} → tournament ${b.tournamentId}`));
    console.warn("Resolve these before enabling enforcement.");
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("Backfill failed:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
