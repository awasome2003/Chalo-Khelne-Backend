/**
 * Backfill Tournament.clubId (Phase 1.1 multi-tenancy).
 *
 * Sets each Tournament's tenant key by walking the existing ownership graph:
 *   Tournament.managerId[] → Manager.clubId (the owning ClubAdmin User _id).
 *
 * Idempotent: only touches tournaments that don't already have a clubId.
 * Uses Model.updateOne ($set) to avoid full-document re-validation of legacy docs.
 *
 * Usage:
 *   node scripts/backfillTournamentClubId.js            # apply
 *   node scripts/backfillTournamentClubId.js --dry-run  # report only, no writes
 *
 * After this reports 0 skipped (or you've resolved the skips), flip the
 * Tournament tenantScope plugin to { enforce: true } and re-run the isolation test.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Tournament = require("../Modal/Tournament");
const { Manager } = require("../Modal/ClubManager");

const DRY_RUN = process.argv.includes("--dry-run");

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set. See .env.example.");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected to MongoDB${DRY_RUN ? " (DRY RUN — no writes)" : ""}`);

  const cursor = Tournament.find({
    $or: [{ clubId: null }, { clubId: { $exists: false } }],
  })
    .select("_id managerId")
    .lean()
    .cursor();

  let updated = 0;
  let skipped = 0;
  const skips = [];

  for (let t = await cursor.next(); t != null; t = await cursor.next()) {
    const mgrIds = (t.managerId || []).map(String);
    let clubId = null;
    if (mgrIds.length) {
      const mgr = await Manager.findOne({ _id: { $in: mgrIds } })
        .select("clubId")
        .lean();
      if (mgr && mgr.clubId) clubId = mgr.clubId;
    }

    if (!clubId) {
      skipped++;
      skips.push(String(t._id));
      continue;
    }

    if (!DRY_RUN) {
      await Tournament.updateOne({ _id: t._id }, { $set: { clubId } });
    }
    updated++;
  }

  console.log(`\nDone. ${DRY_RUN ? "would update" : "updated"}=${updated}  skipped=${skipped}`);
  if (skips.length) {
    console.warn(`\n⚠ ${skips.length} tournament(s) had no resolvable clubId (no manager / manager without clubId):`);
    skips.slice(0, 50).forEach((id) => console.warn(`   ${id}`));
    if (skips.length > 50) console.warn(`   …and ${skips.length - 50} more`);
    console.warn("Resolve these (assign a manager/club) before enabling enforcement.");
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("Backfill failed:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
