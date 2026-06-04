/**
 * Verify Tournament multi-tenancy (Phase 1.1) — READ ONLY, no writes, no app impact.
 *
 * Run this BEFORE flipping the Tournament tenantScope plugin to enforce:true.
 *
 * Part A — Consistency (safety gate):
 *   Every Tournament.clubId must equal the clubId of each manager in its
 *   managerId[]. A mismatch = a tournament whose managers span two clubs
 *   (ambiguous tenant) — must be resolved before enforcing.
 *
 * Part B — Scoping proof:
 *   Binds a throwaway probe model to the SAME `tournaments` collection with the
 *   tenantScope plugin in enforce:true mode, then runs queries inside different
 *   tenant contexts to prove isolation works — WITHOUT touching the real model.
 *
 * Usage:
 *   node scripts/verifyTournamentTenancy.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Tournament = require("../Modal/Tournament");
const { Manager } = require("../Modal/ClubManager");
const { runWithTenant } = require("../utils/tenantContext");
const tenantScope = require("../utils/tenantScope");

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set.");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected (read-only).\n");

  // ── Part A: consistency ──────────────────────────────────────────
  const all = await Tournament.find({}).select("_id clubId managerId").lean();
  const total = all.length;
  let noClub = 0;
  let mismatch = 0;
  const problems = [];

  for (const t of all) {
    if (!t.clubId) {
      noClub++;
      problems.push(`${t._id}: no clubId`);
      continue;
    }
    const mgrIds = (t.managerId || []).map(String);
    if (!mgrIds.length) continue; // clubId set, no managers — acceptable
    const mgrs = await Manager.find({ _id: { $in: mgrIds } }).select("clubId").lean();
    const bad = mgrs.filter((m) => String(m.clubId) !== String(t.clubId));
    if (bad.length) {
      mismatch++;
      problems.push(`${t._id}: clubId=${t.clubId} but ${bad.length} manager(s) belong to a different club`);
    }
  }

  console.log(`Part A — consistency: ${total} tournaments | noClubId=${noClub} | manager mismatch=${mismatch}`);
  if (problems.length) {
    console.log("  Problems:");
    problems.slice(0, 50).forEach((p) => console.log("   - " + p));
    if (problems.length > 50) console.log(`   …and ${problems.length - 50} more`);
  }
  const safeToEnforce = noClub === 0 && mismatch === 0;
  console.log(`  → Safe to enforce: ${safeToEnforce ? "YES ✅" : "NO — fix problems first ❌"}\n`);

  // ── Part B: scoping proof via a probe model (real model untouched) ──
  const distinct = [...new Set(all.filter((t) => t.clubId).map((t) => String(t.clubId)))];
  if (distinct.length === 0) {
    console.log("Part B — no clubIds present; skipping scoping proof.");
  } else {
    const probeSchema = new mongoose.Schema(
      { clubId: mongoose.Schema.Types.ObjectId },
      { strict: false, collection: "tournaments" }
    );
    probeSchema.plugin(tenantScope, { field: "clubId", enforce: true });
    const Probe = mongoose.model("__TenantProbe", probeSchema);

    const clubA = distinct[0];
    const expectedA = all.filter((t) => String(t.clubId) === clubA).length;

    // Inside clubA's context — must return ONLY clubA's tournaments.
    const scopedCount = await runWithTenant({ clubId: clubA, principalType: "ClubAdmin" }, async () => {
      return await Probe.countDocuments({});
    });
    const leaked = await runWithTenant({ clubId: clubA, principalType: "ClubAdmin" }, async () => {
      const docs = await Probe.find({}).select("clubId").lean();
      return docs.filter((d) => String(d.clubId) !== clubA).length;
    });
    // SuperAdmin context — must see everything.
    const saCount = await runWithTenant({ isSuperAdmin: true }, async () => {
      return await Probe.countDocuments({});
    });
    // No context (e.g. player/public) — must see everything (cross-tenant).
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
