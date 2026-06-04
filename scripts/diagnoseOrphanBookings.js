/**
 * Diagnose Booking rows that couldn't get a clubId (Phase 1.1) — READ ONLY.
 *
 * For every booking with no clubId, group by tournamentId and check whether that
 * tournament still exists. Confirms whether these are orphans of DELETED
 * tournaments (expected) vs. live tournaments we somehow missed (would be a bug).
 *
 * Usage:  node scripts/diagnoseOrphanBookings.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Booking = require("../Modal/BookingModel");
const Tournament = require("../Modal/Tournament");

const MISSING = { $or: [{ clubId: null }, { clubId: { $exists: false } }] };

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set.");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected (read-only).\n");

  const orphans = await Booking.find(MISSING)
    .select("_id tournamentId userId status")
    .lean();
  console.log(`Bookings with no clubId: ${orphans.length}`);

  // Group by tournamentId
  const byTournament = new Map();
  let withUser = 0;
  const statusCounts = {};
  for (const b of orphans) {
    const key = String(b.tournamentId);
    byTournament.set(key, (byTournament.get(key) || 0) + 1);
    if (b.userId) withUser++;
    statusCounts[b.status] = (statusCounts[b.status] || 0) + 1;
  }

  const distinctIds = [...byTournament.keys()];
  console.log(`Distinct tournaments referenced: ${distinctIds.length}`);
  console.log(`Player-owned (have userId): ${withUser} | Guest (no userId): ${orphans.length - withUser}`);
  console.log(`Status breakdown:`, statusCounts);

  // Which of those tournaments still EXIST?
  const validIds = distinctIds.filter((id) => mongoose.isValidObjectId(id));
  const existing = await Tournament.find({ _id: { $in: validIds } }).select("_id").lean();
  const existingSet = new Set(existing.map((t) => String(t._id)));

  const deleted = distinctIds.filter((id) => !existingSet.has(id));
  console.log(`\nReferenced tournaments that STILL EXIST: ${existingSet.size}`);
  console.log(`Referenced tournaments that are DELETED/missing: ${deleted.length}`);

  if (existingSet.size > 0) {
    console.log(`\n⚠ These tournaments exist but their bookings have no clubId — investigate:`);
    [...existingSet].slice(0, 20).forEach((id) => console.log(`   ${id} (${byTournament.get(id)} bookings)`));
  } else {
    console.log(`\n✅ All orphan bookings reference DELETED tournaments — they cannot be tenant-assigned.`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("Diagnose failed:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
