/**
 * Backfill clubId on Turf + TurfBooking (Phase 1.1 multi-tenancy).
 *
 *   Turf.clubId        = Turf.owner   (the owning tenant: club or individual)
 *   TurfBooking.clubId = its turf's clubId (turfId → Turf.clubId)
 *
 * Idempotent — only touches docs without a clubId.
 *
 * Usage:
 *   node scripts/backfillTurfClubId.js            # apply
 *   node scripts/backfillTurfClubId.js --dry-run  # report only
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Turf = require("../src/modules/org/models/Turf");
const TurfBooking = require("../src/modules/org/models/TurfBooking");

const DRY_RUN = process.argv.includes("--dry-run");
const MISSING = { $or: [{ clubId: null }, { clubId: { $exists: false } }] };

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set.");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected${DRY_RUN ? " (DRY RUN — no writes)" : ""}`);

  // ── Turf: clubId = owner ──
  let turfUpdated;
  if (DRY_RUN) {
    turfUpdated = await Turf.countDocuments(MISSING);
  } else {
    const r = await Turf.updateMany(MISSING, [{ $set: { clubId: "$owner" } }]);
    turfUpdated = r.modifiedCount || 0;
  }
  console.log(`Turf         ${DRY_RUN ? "would update" : "updated"}=${turfUpdated}`);

  // ── TurfBooking: clubId = turf's clubId (use owner as fallback for dry-run) ──
  const turfs = await Turf.find({}).select("_id owner clubId").lean();
  let bookingUpdated = 0;
  for (const t of turfs) {
    const club = t.clubId || t.owner;
    if (!club) continue;
    const filter = { turfId: t._id, ...MISSING };
    if (DRY_RUN) {
      bookingUpdated += await TurfBooking.countDocuments(filter);
    } else {
      const r = await TurfBooking.updateMany(filter, { $set: { clubId: club } });
      bookingUpdated += r.modifiedCount || 0;
    }
  }
  const bookingMissing = (await TurfBooking.countDocuments(MISSING)) - (DRY_RUN ? bookingUpdated : 0);
  console.log(`TurfBooking  ${DRY_RUN ? "would update" : "updated"}=${bookingUpdated}  still-missing=${Math.max(0, bookingMissing)}`);
  if (bookingMissing > 0) {
    console.warn(`⚠ ${bookingMissing} turf booking(s) reference a deleted turf (orphans) — inert under enforcement.`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("Backfill failed:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
