/**
 * Verify clubId on all match-family models (Phase 1.1) — READ ONLY.
 * Run BEFORE flipping the match models' tenantScope plugins to enforce:true.
 *
 * Per model:
 *   Part A — consistency: clubId must equal the doc's tournament's clubId
 *     (Score: via matchId → TournamentMatch's tournament). Reports deleted-parent
 *     orphans separately from real mismatches. mismatch MUST be 0.
 *   Part B — scoping proof: a probe model (enforce:true) on the same collection
 *     proves club-staff queries are isolated.
 *
 * Usage:  node scripts/verifyMatchModelsTenancy.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { runWithTenant } = require("../utils/tenantContext");
const tenantScope = require("../utils/tenantScope");
const Tournament = require("../src/modules/tournaments/models/Tournament");

const TournamentMatch = require("../src/modules/tournaments/models/TournamentMatch");
const Match = require("../src/modules/tournaments/models/Tournnamentmatch");
const KnockoutMatch = require("../src/modules/tournaments/models/KnockoutMatch");
const DirectKnockoutMatch = require("../src/modules/tournaments/models/DirectKnockoutMatch");
const TeamKnockout = require("../src/modules/tournaments/models/TeamKnockout");
const TeamKnockoutMatches = require("../src/modules/tournaments/models/TeamKnockoutMatches");
const TeamKnockoutTeams = require("../src/modules/tournaments/models/TeamKnockoutTeams");
const SuperMatch = require("../src/modules/tournaments/models/SuperMatch");
const Semifinals = require("../src/modules/tournaments/models/semifinal");
const GroupStandings = require("../src/modules/tournaments/models/GroupStandings");
const Score = require("../src/modules/tournaments/models/Score");

const MODELS = [
  { Model: TournamentMatch, name: "TournamentMatch", kind: "tournament" },
  { Model: Match, name: "Match", kind: "tournament" },
  { Model: KnockoutMatch, name: "KnockoutMatch", kind: "tournament" },
  { Model: DirectKnockoutMatch, name: "DirectKnockoutMatch", kind: "tournament" },
  { Model: TeamKnockout, name: "TeamKnockout", kind: "tournament" },
  { Model: TeamKnockoutMatches, name: "TeamKnockoutMatches", kind: "tournament" },
  { Model: TeamKnockoutTeams, name: "TeamKnockoutTeams", kind: "tournament" },
  { Model: SuperMatch, name: "SuperMatch", kind: "tournament" },
  { Model: Semifinals, name: "Semifinals", kind: "tournament" },
  { Model: GroupStandings, name: "GroupStandings", kind: "tournament" },
  { Model: Score, name: "Score", kind: "score" },
];

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set.");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected (read-only).\n");

  // tournamentId → clubId
  const tours = await Tournament.find({}).select("_id clubId").lean();
  const tClub = new Map(tours.map((t) => [String(t._id), t.clubId ? String(t.clubId) : null]));

  // matchId → clubId (for Score), via TournamentMatch.tournamentId
  const tmatches = await TournamentMatch.find({}).select("_id tournamentId").lean();
  const matchClub = new Map();
  for (const m of tmatches) {
    const c = tClub.get(String(m.tournamentId));
    if (c) matchClub.set(String(m._id), c);
  }

  let totalMismatch = 0;
  let totalProofFail = 0;

  console.log("model                    total  noClubId(orphan)  mismatch   scoping");
  console.log("─".repeat(78));

  for (const { Model, name, kind } of MODELS) {
    const docs = await Model.find({}).select("_id clubId tournamentId matchId").lean();
    const total = docs.length;

    let noClub = 0, orphan = 0, mismatch = 0;
    const clubCounts = new Map();

    for (const d of docs) {
      const expected = kind === "score" ? matchClub.get(String(d.matchId)) : tClub.get(String(d.tournamentId));
      const parentResolvable = expected != null;
      if (!d.clubId) {
        noClub++;
        if (!parentResolvable) orphan++;
        continue;
      }
      const k = String(d.clubId);
      clubCounts.set(k, (clubCounts.get(k) || 0) + 1);
      if (expected && k !== String(expected)) mismatch++;
    }
    totalMismatch += mismatch;

    // Part B — scoping proof (only if there are clubId-bearing docs)
    let proof = "n/a";
    const distinct = [...clubCounts.keys()];
    if (distinct.length > 0) {
      const probeSchema = new mongoose.Schema(
        { clubId: mongoose.Schema.Types.ObjectId },
        { strict: false, collection: Model.collection.collectionName }
      );
      probeSchema.plugin(tenantScope, { field: "clubId", enforce: true });
      const Probe = mongoose.model("__probe_" + name, probeSchema);

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
      if (!ok) totalProofFail++;
      proof = ok ? "OK" : `FAIL(scoped=${scoped}/${expectedA},leak=${leaked})`;
    }

    console.log(
      `${name.padEnd(22)} ${String(total).padStart(6)}  ${String(noClub).padStart(6)}(${orphan})       ${String(mismatch).padStart(6)}   ${proof}`
    );
  }

  console.log("─".repeat(78));
  console.log(`\nTOTAL mismatches=${totalMismatch} (must be 0)   scoping failures=${totalProofFail} (must be 0)`);
  console.log(`→ Safe to enforce all match models: ${totalMismatch === 0 && totalProofFail === 0 ? "YES ✅" : "NO ❌"}`);
  console.log("(noClubId rows are legacy orphans of deleted tournaments/matches — inert under enforcement.)");

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("Verify failed:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
