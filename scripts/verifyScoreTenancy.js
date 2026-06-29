/**
 * Verify Score multi-tenancy (Phase 1.1) — READ ONLY.
 * Run BEFORE flipping the Score tenantScope plugin to enforce:true.
 *
 * Part A — consistency: each Score.clubId must equal its match's clubId
 *   (matchId resolved across all match collections). mismatch MUST be 0.
 * Part B — scoping proof on the `scores` collection via an enforce:true probe.
 *
 * Usage:  node scripts/verifyScoreTenancy.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { runWithTenant } = require("../utils/tenantContext");
const tenantScope = require("../utils/tenantScope");
const Score = require("../src/modules/tournaments/models/Score");

const MATCH_MODELS = [
  require("../src/modules/tournaments/models/Tournnamentmatch"),
  require("../src/modules/tournaments/models/TournamentMatch"),
  require("../src/modules/tournaments/models/KnockoutMatch"),
  require("../src/modules/tournaments/models/DirectKnockoutMatch"),
  require("../src/modules/tournaments/models/SuperMatch"),
  require("../src/modules/tournaments/models/TeamKnockoutMatches"),
  require("../src/modules/tournaments/models/semifinal"),
];

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set.");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected (read-only).\n");

  const matchClub = new Map();
  for (const M of MATCH_MODELS) {
    const rows = await M.find({ clubId: { $ne: null } }).select("_id clubId").lean();
    for (const r of rows) matchClub.set(String(r._id), String(r.clubId));
  }

  // ── Part A ──
  const all = await Score.find({}).select("_id clubId matchId").lean();
  const total = all.length;
  let noClub = 0, orphan = 0, mismatch = 0;
  const clubCounts = new Map();
  for (const s of all) {
    const expected = matchClub.get(String(s.matchId));
    if (!s.clubId) {
      noClub++;
      if (!expected) orphan++;
      continue;
    }
    clubCounts.set(String(s.clubId), (clubCounts.get(String(s.clubId)) || 0) + 1);
    if (expected && String(s.clubId) !== expected) mismatch++;
  }
  console.log(`Part A — consistency: ${total} scores | noClubId=${noClub} (deleted-match orphans=${orphan}) | mismatch=${mismatch}`);
  console.log(`  → Safe to enforce: ${mismatch === 0 ? "YES ✅ (mismatch=0)" : "NO ❌"}\n`);

  // ── Part B ──
  const distinct = [...clubCounts.keys()];
  if (distinct.length === 0) {
    console.log("Part B — no clubId scores yet; run the backfill first.");
  } else {
    const probeSchema = new mongoose.Schema(
      { clubId: mongoose.Schema.Types.ObjectId },
      { strict: false, collection: Score.collection.collectionName }
    );
    probeSchema.plugin(tenantScope, { field: "clubId", enforce: true });
    const Probe = mongoose.model("__ScoreTenantProbe", probeSchema);

    const clubA = distinct[0];
    const expectedA = clubCounts.get(clubA);
    const scoped = await runWithTenant({ clubId: clubA, principalType: "ClubAdmin" }, async () => {
      return await Probe.countDocuments({});
    });
    const leaked = await runWithTenant({ clubId: clubA, principalType: "ClubAdmin" }, async () => {
      const ds = await Probe.find({}).select("clubId").lean();
      return ds.filter((x) => String(x.clubId) !== clubA).length;
    });
    const ok = scoped === expectedA && leaked === 0;
    console.log(`Part B — scoping proof (clubA=${clubA}): scoped=${scoped}/${expectedA}, leaked=${leaked}  → ${ok ? "YES ✅" : "NO ❌"}`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("Verify failed:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
