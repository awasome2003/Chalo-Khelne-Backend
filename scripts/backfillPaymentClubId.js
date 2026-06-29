/**
 * Backfill Payment.clubId (Phase 1.1 multi-tenancy).
 *
 * A payment's tenant = its tournament's tenant: Payment.eventId →
 * Tournament.clubId (already backfilled). Idempotent — only touches payments
 * without a clubId. For each tournament with a clubId, updateMany its payments.
 *
 * Usage:
 *   node scripts/backfillPaymentClubId.js            # apply
 *   node scripts/backfillPaymentClubId.js --dry-run  # report only, no writes
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Payment = require("../src/modules/commerce/models/Payments");
const Tournament = require("../src/modules/tournaments/models/Tournament");

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
    const filter = { eventId: t._id, ...MISSING };
    if (DRY_RUN) {
      updated += await Payment.countDocuments(filter);
    } else {
      const r = await Payment.updateMany(filter, { $set: { clubId: t.clubId } });
      updated += r.modifiedCount || 0;
    }
  }

  const stillMissing = await Payment.countDocuments(MISSING) - (DRY_RUN ? updated : 0);
  console.log(`\nDone. ${DRY_RUN ? "would update" : "updated"}=${updated}  still-missing=${Math.max(0, stillMissing)}`);
  if (stillMissing > 0) {
    console.warn(`\n⚠ ${stillMissing} payment(s) reference a tournament with no clubId (orphaned/legacy).`);
    const sample = await Payment.find(MISSING).select("_id eventId status").limit(20).lean();
    sample.forEach((p) => console.warn(`   payment ${p._id} → tournament ${p.eventId} [${p.status}]`));
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("Backfill failed:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
