/**
 * Verify Payment multi-tenancy (Phase 1.1) — READ ONLY, no writes, no app impact.
 * Run BEFORE flipping the Payment tenantScope plugin to enforce:true.
 *
 * Part A — Consistency (safety gate):
 *   Every Payment.clubId must equal its tournament's clubId
 *   (Payment.eventId → Tournament.clubId). Reports payments with no clubId
 *   (orphans of deleted tournaments) separately from real mismatches.
 *
 * Part B — Scoping proof:
 *   A throwaway probe model on the SAME `payments` collection with enforce:true
 *   proves isolation works, without touching the real model.
 *
 * Usage:  node scripts/verifyPaymentTenancy.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Payment = require("../Modal/Payments");
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

  const tours = await Tournament.find({}).select("_id clubId").lean();
  const tClub = new Map(tours.map((t) => [String(t._id), t.clubId ? String(t.clubId) : null]));

  // ── Part A: consistency ──────────────────────────────────────────
  const all = await Payment.find({}).select("_id clubId eventId").lean();
  const total = all.length;
  let noClub = 0;
  let orphanDeleted = 0;
  let mismatch = 0;
  const problems = [];

  for (const p of all) {
    const tExists = tClub.has(String(p.eventId));
    if (!p.clubId) {
      noClub++;
      if (!tExists) orphanDeleted++;
      if (problems.length < 30) problems.push(`${p._id}: no clubId${tExists ? "" : " (tournament deleted)"}`);
      continue;
    }
    const expected = tClub.get(String(p.eventId));
    if (expected && String(p.clubId) !== expected) {
      mismatch++;
      if (problems.length < 30) problems.push(`${p._id}: clubId=${p.clubId} but tournament's clubId=${expected}`);
    }
  }

  console.log(`Part A — consistency: ${total} payments | noClubId=${noClub} (of which deleted-tournament orphans=${orphanDeleted}) | mismatch=${mismatch}`);
  if (problems.length) {
    console.log("  Problems (first 30):");
    problems.forEach((p) => console.log("   - " + p));
  }
  const onlyOrphans = mismatch === 0 && noClub === orphanDeleted;
  console.log(`  → Mismatches: ${mismatch} (must be 0). Remaining noClubId are ${onlyOrphans ? "ALL deleted-tournament orphans (inert under enforcement)" : "NOT all orphans — investigate"}\n`);

  // ── Part B: scoping proof via probe model (real model untouched) ──
  const distinct = [...new Set(all.filter((p) => p.clubId).map((p) => String(p.clubId)))];
  if (distinct.length === 0) {
    console.log("Part B — no clubIds present; skipping scoping proof.");
  } else {
    const probeSchema = new mongoose.Schema(
      { clubId: mongoose.Schema.Types.ObjectId },
      { strict: false, collection: "payments" }
    );
    probeSchema.plugin(tenantScope, { field: "clubId", enforce: true });
    const Probe = mongoose.model("__PaymentTenantProbe", probeSchema);

    const clubA = distinct[0];
    const expectedA = all.filter((p) => String(p.clubId) === clubA).length;

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
