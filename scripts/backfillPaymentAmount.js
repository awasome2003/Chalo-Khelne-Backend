/**
 * One-time backfill: fix bookings where paymentStatus is "paid" but
 * paymentAmount was never written (left at 0 / null) — a side effect of the
 * pre-Day-3 createBooking that set totalFee but not paymentAmount. We copy
 * totalFee → paymentAmount for those records so club-admin finance revenue
 * reflects historical paid registrations.
 *
 * Safe to re-run (idempotent): it only touches paid bookings whose
 * paymentAmount is missing/0 AND whose totalFee is > 0. Bookings with no
 * recoverable amount (totalFee also 0) are left untouched and reported.
 *
 * Usage:
 *   node scripts/backfillPaymentAmount.js          # apply the fix
 *   node scripts/backfillPaymentAmount.js --dry     # preview only, no writes
 */
const mongoose = require("mongoose");
require("dotenv").config();

const Booking = require("../src/modules/tournaments/models/BookingModel");

const DRY_RUN = process.argv.includes("--dry");

// Paid bookings whose stored amount is missing or zero.
const FILTER = {
  paymentStatus: "paid",
  $or: [
    { paymentAmount: { $exists: false } },
    { paymentAmount: null },
    { paymentAmount: 0 },
  ],
};

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set. See .env.example.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected to MongoDB${DRY_RUN ? " (DRY RUN — no writes)" : ""}`);

  const candidates = await Booking.countDocuments(FILTER);
  const recoverable = await Booking.countDocuments({ ...FILTER, totalFee: { $gt: 0 } });
  const unrecoverable = candidates - recoverable;

  console.log(`Paid bookings with missing/zero paymentAmount: ${candidates}`);
  console.log(`  → recoverable (totalFee > 0):   ${recoverable}`);
  console.log(`  → unrecoverable (totalFee = 0): ${unrecoverable} (left untouched)`);

  if (DRY_RUN) {
    console.log("Dry run complete — no changes made.");
    await mongoose.disconnect();
    process.exit(0);
  }

  if (recoverable === 0) {
    console.log("Nothing to backfill.");
    await mongoose.disconnect();
    process.exit(0);
  }

  // Aggregation-pipeline update: set paymentAmount = totalFee for the
  // recoverable set. Pipeline form lets us reference the document's own field.
  const result = await Booking.updateMany(
    { ...FILTER, totalFee: { $gt: 0 } },
    [{ $set: { paymentAmount: "$totalFee" } }]
  );

  console.log(`Backfill complete. Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("Backfill failed:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
