/**
 * Backfill Turf.isApproved = true for EXISTING turfs (turf-registration feature).
 *
 * Run this ONCE, NOW — before any self-registered turfs exist. At this point
 * every turf is club/manager-created and legitimate, so all should be publicly
 * visible. Going forward, club turfs are auto-approved on create and
 * independently-registered turfs start unapproved (pending SuperAdmin approval),
 * so this bulk-approve is a one-time grandfather migration.
 *
 * Usage:
 *   node scripts/backfillTurfApproval.js --dry-run
 *   node scripts/backfillTurfApproval.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Turf = require("../src/modules/org/models/Turf");

const DRY_RUN = process.argv.includes("--dry-run");

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set.");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected${DRY_RUN ? " (DRY RUN — no writes)" : ""}`);

  const filter = { isApproved: { $ne: true } };
  const count = await Turf.countDocuments(filter);
  console.log(`Turfs not yet explicitly approved: ${count}`);

  if (!DRY_RUN && count > 0) {
    const r = await Turf.updateMany(filter, { $set: { isApproved: true } });
    console.log(`Approved ${r.modifiedCount} turf(s).`);
  } else if (DRY_RUN) {
    console.log(`Would approve ${count} turf(s).`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("Backfill failed:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
