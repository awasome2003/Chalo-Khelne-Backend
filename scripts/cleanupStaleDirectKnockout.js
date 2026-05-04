#!/usr/bin/env node
/**
 * Cleanup script: stale DirectKnockoutMatch records on tournaments whose
 * sport types do NOT include "knockout" alone (i.e. tournaments where every
 * sport is "knockout + group stage" or "group stage" only — those should
 * never have DirectKnockoutMatch records).
 *
 * Why: a now-fixed bug in MGrouptabs.fetchKnockoutMatches merged results
 * from BOTH the SuperMatch endpoint AND the DirectKnockoutMatch endpoint
 * into the Knockout sub-tab. If managers had ever experimented with the
 * Direct Knockout flow on a GS+KO tournament, those orphan records bled
 * through into the Group-Stage Knockout view. The frontend now picks one
 * source per sport type, so these orphans are inert — but worth removing
 * for a clean DB state.
 *
 * Modes:
 *   node scripts/cleanupStaleDirectKnockout.js              # dry-run (default)
 *   node scripts/cleanupStaleDirectKnockout.js --apply      # actually delete
 *   node scripts/cleanupStaleDirectKnockout.js --tournament <id>
 *     # restrict to one tournament; combine with --apply to delete
 *
 * The script always lists the orphan counts (per tournament) before doing
 * anything destructive. Re-runnable.
 */

require("dotenv").config();
const mongoose = require("mongoose");

const Tournament = require("../Modal/Tournament");
const DirectKnockoutMatch = require("../Modal/DirectKnockoutMatch");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const tournamentArgIdx = args.indexOf("--tournament");
const SCOPE_ID = tournamentArgIdx >= 0 ? args[tournamentArgIdx + 1] : null;

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✓ Connected to MongoDB");
  console.log(`  Mode: ${APPLY ? "APPLY (will delete)" : "DRY-RUN"}`);
  if (SCOPE_ID) console.log(`  Scoped to tournament: ${SCOPE_ID}`);
  console.log("");

  // Pull every tournament (or just one if scoped). For each, look at every
  // sport entry's `type`. A sport is "direct-eligible" if its type === "knockout"
  // exactly. DirectKnockoutMatch records are valid only for direct-eligible
  // sports — anything else is stale.
  const tournamentFilter = SCOPE_ID
    ? { _id: new mongoose.Types.ObjectId(SCOPE_ID) }
    : {};
  const tournaments = await Tournament.find(tournamentFilter)
    .select("_id title sports")
    .lean();

  console.log(`  Tournaments scanned: ${tournaments.length}\n`);

  let totalOrphans = 0;
  let totalDeleted = 0;
  const summary = [];

  for (const t of tournaments) {
    // Map sportId → type for this tournament.
    const sportTypeBySportId = {};
    for (const s of t.sports || []) {
      if (s.sportId) sportTypeBySportId[String(s.sportId)] = String(s.type || "");
    }

    // Find DirectKnockoutMatch records for this tournament.
    const dkMatches = await DirectKnockoutMatch
      .find({ tournamentId: t._id })
      .select("_id sportId")
      .lean();
    if (dkMatches.length === 0) continue;

    // Bucket each DK record: stale (sport's type isn't "knockout") vs valid.
    const staleIds = [];
    const staleBySport = {};
    let validCount = 0;
    for (const m of dkMatches) {
      const sId = m.sportId ? String(m.sportId) : null;
      const type = sId ? sportTypeBySportId[sId] : null;
      const isStale = type !== "knockout";  // includes null/undefined types
      if (isStale) {
        staleIds.push(m._id);
        const bucketKey = sId ? `${sId} (${type || "no sport"})` : "(no sportId)";
        staleBySport[bucketKey] = (staleBySport[bucketKey] || 0) + 1;
      } else {
        validCount++;
      }
    }

    if (staleIds.length === 0) continue;

    totalOrphans += staleIds.length;
    summary.push({
      tournamentId: t._id.toString(),
      title: t.title || "(no title)",
      stale: staleIds.length,
      valid: validCount,
      staleBySport,
    });

    if (APPLY) {
      const res = await DirectKnockoutMatch.deleteMany({ _id: { $in: staleIds } });
      totalDeleted += res.deletedCount;
    }
  }

  // Print summary table.
  if (summary.length === 0) {
    console.log("  No stale DirectKnockoutMatch records found. ✓");
  } else {
    console.log(`  Tournaments with stale records: ${summary.length}\n`);
    for (const s of summary) {
      console.log(`  • ${s.title.padEnd(35)} (${s.tournamentId})`);
      console.log(`      stale: ${s.stale}   valid (real direct-KO): ${s.valid}`);
      for (const [k, v] of Object.entries(s.staleBySport)) {
        console.log(`        - ${k}: ${v}`);
      }
    }
    console.log("");
  }

  console.log(`${"═".repeat(60)}`);
  console.log(`  Total stale records${APPLY ? " (deleted)" : " (would delete)"}: ${APPLY ? totalDeleted : totalOrphans}`);
  if (!APPLY && totalOrphans > 0) {
    console.log(`  This was a DRY RUN. Re-run with --apply to actually delete.`);
    if (SCOPE_ID) {
      console.log(`  e.g.  node scripts/cleanupStaleDirectKnockout.js --tournament ${SCOPE_ID} --apply`);
    } else {
      console.log(`  e.g.  node scripts/cleanupStaleDirectKnockout.js --apply`);
    }
  }
  console.log("");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("✗ Cleanup failed:", err);
  process.exit(1);
});
