/**
 * One-time dedupe: remove duplicate (userId, tournamentId) bookings so the new
 * partial unique index on Booking can build cleanly on deploy.
 *
 * Only REAL-user bookings are considered (userId is an ObjectId). Guest
 * bookings (userId === null, manager bulk upload) are exempt from the unique
 * index, so they're ignored here.
 *
 * Within each duplicate group we KEEP the "best" booking and delete the rest.
 * "Best" = most-advanced status (confirmed > pending > cancelled), then paid
 * over unpaid, then most recently created. This preserves a player's real
 * registration and only drops accidental race-condition duplicates.
 *
 * Usage:
 *   node scripts/dedupeBookings.js --dry     # preview only, no writes
 *   node scripts/dedupeBookings.js           # apply (delete duplicates)
 */
const mongoose = require("mongoose");
require("dotenv").config();

const Booking = require("../src/modules/tournaments/models/BookingModel");

const DRY_RUN = process.argv.includes("--dry");

const STATUS_RANK = { confirmed: 3, pending: 2, cancelled: 1 };
function rankTuple(b) {
  return [
    STATUS_RANK[b.status] || 0,
    b.paymentStatus === "paid" ? 1 : 0,
    new Date(b.createdAt || 0).getTime(),
  ];
}
// Returns whichever booking should be KEPT.
function preferred(a, b) {
  const ra = rankTuple(a);
  const rb = rankTuple(b);
  for (let i = 0; i < ra.length; i++) {
    if (ra[i] !== rb[i]) return ra[i] > rb[i] ? a : b;
  }
  return a;
}

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set. See .env.example.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected to MongoDB${DRY_RUN ? " (DRY RUN — no writes)" : ""}`);

  // Find duplicate groups among real-user bookings.
  const dupGroups = await Booking.aggregate([
    { $match: { userId: { $type: "objectId" } } },
    {
      $group: {
        _id: { userId: "$userId", tournamentId: "$tournamentId" },
        ids: { $push: "$_id" },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  console.log(`Duplicate (userId, tournamentId) groups: ${dupGroups.length}`);

  const toDelete = [];
  for (const g of dupGroups) {
    const docs = await Booking.find({ _id: { $in: g.ids } }).lean();
    let keep = docs[0];
    for (const d of docs) keep = preferred(keep, d);
    const removeIds = docs
      .filter((d) => String(d._id) !== String(keep._id))
      .map((d) => d._id);
    toDelete.push(...removeIds);
    console.log(
      `  user ${g._id.userId} / tournament ${g._id.tournamentId}: ${docs.length} bookings ` +
      `→ keep ${keep._id} (${keep.status}/${keep.paymentStatus}), delete ${removeIds.length}`
    );
  }

  console.log(`Total duplicate bookings to delete: ${toDelete.length}`);

  if (DRY_RUN) {
    console.log("Dry run complete — no changes made.");
    await mongoose.disconnect();
    process.exit(0);
  }

  if (toDelete.length) {
    const r = await Booking.deleteMany({ _id: { $in: toDelete } });
    console.log(`Deleted ${r.deletedCount} duplicate bookings.`);
  } else {
    console.log("No duplicates to remove.");
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("Dedupe failed:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
