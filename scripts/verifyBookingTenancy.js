/**
 * Verify Booking multi-tenancy (Phase 1.1) — READ ONLY, no writes, no app impact.
 * Run BEFORE flipping the Booking tenantScope plugin to enforce:true.
 *
 * Part A — Consistency (safety gate):
 *   Every Booking.clubId must equal its tournament's clubId
 *   (Booking.tournamentId → Tournament.clubId).
 *
 * Part B — Scoping proof:
 *   A throwaway probe model on the SAME `bookings` collection with enforce:true
 *   proves isolation works, without touching the real model.
 *
 * Usage:  node scripts/verifyBookingTenancy.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Booking = require("../Modal/BookingModel");
const Tournament = require("../Modal/Tournament");
const { runWithTenant } = require("../utils/tenantContext");
const tenantScope = require("../utils/tenantScope");

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set.");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected (read-only).\n");

  // Tournament clubId lookup (few tournaments).
  const tours = await Tournament.find({}).select("_id clubId").lean();
  const tClub = new Map(tours.map((t) => [String(t._id), t.clubId ? String(t.clubId) : null]));

  // ── Part A: consistency ──────────────────────────────────────────
  const all = await Booking.find({}).select("_id clubId tournamentId").lean();
  const total = all.length;
  let noClub = 0;
  let mismatch = 0;
  const problems = [];

  for (const b of all) {
    if (!b.clubId) {
      noClub++;
      if (problems.length < 50) problems.push(`${b._id}: no clubId`);
      continue;
    }
    const expected = tClub.get(String(b.tournamentId));
    if (expected && String(b.clubId) !== expected) {
      mismatch++;
      if (problems.length < 50) problems.push(`${b._id}: clubId=${b.clubId} but tournament's clubId=${expected}`);
    }
  }

  console.log(`Part A — consistency: ${total} bookings | noClubId=${noClub} | tournament mismatch=${mismatch}`);
  if (problems.length) {
    console.log("  Problems (first 50):");
    problems.forEach((p) => console.log("   - " + p));
  }
  const safeToEnforce = noClub === 0 && mismatch === 0;
  console.log(`  → Safe to enforce: ${safeToEnforce ? "YES ✅" : "NO — fix problems first ❌"}\n`);

  // ── Part B: scoping proof via probe model (real model untouched) ──
  const distinct = [...new Set(all.filter((b) => b.clubId).map((b) => String(b.clubId)))];
  if (distinct.length === 0) {
    console.log("Part B — no clubIds present; skipping scoping proof.");
  } else {
    const probeSchema = new mongoose.Schema(
      { clubId: mongoose.Schema.Types.ObjectId },
      { strict: false, collection: "bookings" }
    );
    probeSchema.plugin(tenantScope, { field: "clubId", enforce: true });
    const Probe = mongoose.model("__BookingTenantProbe", probeSchema);

    const clubA = distinct[0];
    const expectedA = all.filter((b) => String(b.clubId) === clubA).length;

    const scopedCount = await runWithTenant({ clubId: clubA, principalType: "ClubAdmin" }, async () => {
      return await Probe.countDocuments({});
    });
    const leaked = await runWithTenant({ clubId: clubA, principalType: "ClubAdmin" }, async () => {
      const docs = await Probe.find({}).select("clubId").lean();
      return docs.filter((d) => String(d.clubId) !== clubA).length;
    });
    const saCount = await runWithTenant({ isSuperAdmin: true }, async () => {
      return await Probe.countDocuments({});
    });
    const noCtxCount = await Probe.countDocuments({});

    console.log(`Part B — scoping proof (clubA=${clubA}, total=${total}):`);
    console.log(`   clubA-scoped count        = ${scopedCount}  (expected ${expectedA})`);
    console.log(`   other-club docs leaked     = ${leaked}  (expected 0)`);
    console.log(`   superadmin-context count   = ${saCount}  (expected ${total})`);
    console.log(`   no-context count           = ${noCtxCount}  (expected ${total})`);
    const ok = scopedCount === expectedA && leaked === 0 && saCount === total && noCtxCount === total;
    console.log(`   → Scoping mechanism correct: ${ok ? "YES ✅" : "NO ❌"}\n`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("Verify failed:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
