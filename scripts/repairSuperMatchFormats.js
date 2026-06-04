#!/usr/bin/env node
/**
 * Repair script: re-stamp SuperMatch.matchFormat from each match's
 * tournament configuration.
 *
 * Background: createSuperGroupMatch in MatchFactory.js was creating
 * SuperMatch docs WITHOUT a matchFormat field. Mongoose then applied the
 * schema defaults (setsToWin: 3, maxSets: 5, maxGames: 5 — best-of-5),
 * causing bulk score upload to reject best-of-3 results with
 * "Need 3 sets to win" errors.
 *
 * The factory is now fixed (see commit). This script repairs already-saved
 * docs whose matchFormat disagrees with their tournament's configuration.
 *
 * Idempotent: a doc whose matchFormat already matches the tournament is
 * skipped. Re-running is safe.
 *
 * Usage:
 *   cd server && node scripts/repairSuperMatchFormats.js          # apply
 *   cd server && node scripts/repairSuperMatchFormats.js --dry    # report only
 */

require("dotenv").config();
const mongoose = require("mongoose");
const SuperMatch = require("../Modal/SuperMatch");
const Tournament = require("../Modal/Tournament");
const { getMatchFormat, resolveSportId } = require("../utils/sportTrackUtils");

const DRY_RUN = process.argv.includes("--dry");

function buildExpectedFormat(tf) {
  if (!tf) tf = {};
  const totalSets = tf.totalSets || 1;
  const totalGames = tf.totalGames || 1;
  return {
    setsToWin: tf.setsToWin || Math.ceil(totalSets / 2),
    maxSets: totalSets,
    gamesToWin: tf.gamesToWin || Math.ceil(totalGames / 2),
    maxGames: totalGames,
    pointsToWinGame: tf.pointsToWinGame ?? null,
    marginToWin: tf.marginToWin ?? null,
    deuceRule: tf.deuceRule ?? false,
    maxPointsPerGame: tf.maxPointsCap ?? null,
    serviceRule: {
      pointsPerService: tf.serviceAlternate ?? 2,
      deuceServicePoints: 1,
    },
  };
}

function formatsDiffer(saved, expected) {
  if (!saved) return true;
  const keys = ["setsToWin", "maxSets", "gamesToWin", "maxGames", "pointsToWinGame", "marginToWin", "deuceRule", "maxPointsPerGame"];
  for (const k of keys) {
    if (saved[k] !== expected[k]) return true;
  }
  const sR = saved.serviceRule || {};
  if (sR.pointsPerService !== expected.serviceRule.pointsPerService) return true;
  if (sR.deuceServicePoints !== expected.serviceRule.deuceServicePoints) return true;
  return false;
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`✓ Connected — ${DRY_RUN ? "DRY RUN" : "APPLY"} mode\n`);

  const tournamentCache = new Map();
  async function loadTournament(id) {
    const key = String(id);
    if (tournamentCache.has(key)) return tournamentCache.get(key);
    const t = await Tournament.findById(id).lean();
    tournamentCache.set(key, t);
    return t;
  }

  const all = await SuperMatch.find({}, "_id tournamentId sportId matchFormat status").lean();
  console.log(`Scanning ${all.length} SuperMatch docs…\n`);

  let okCount = 0;
  let fixedCount = 0;
  let skippedNoTournament = 0;
  const fixedByTournament = new Map();

  for (const m of all) {
    const t = await loadTournament(m.tournamentId);
    if (!t) {
      skippedNoTournament++;
      continue;
    }
    const tf = getMatchFormat(t, resolveSportId(t, m.sportId)) || t.sports?.[0]?.matchFormat || {};
    const expected = buildExpectedFormat(tf);

    if (!formatsDiffer(m.matchFormat, expected)) {
      okCount++;
      continue;
    }

    fixedCount++;
    const tKey = String(m.tournamentId);
    fixedByTournament.set(tKey, (fixedByTournament.get(tKey) || 0) + 1);

    if (!DRY_RUN) {
      await SuperMatch.updateOne({ _id: m._id }, { $set: { matchFormat: expected } });
    }
  }

  console.log(`${"═".repeat(60)}`);
  console.log(`  ${DRY_RUN ? "DRY RUN SUMMARY" : "REPAIR COMPLETE"}`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  Scanned:                ${all.length}`);
  console.log(`  Already correct:        ${okCount}`);
  console.log(`  ${DRY_RUN ? "Would repair:           " : "Repaired:               "}${fixedCount}`);
  console.log(`  Skipped (no tournament):${skippedNoTournament}`);
  if (fixedByTournament.size > 0) {
    console.log(`\n  ${DRY_RUN ? "Would fix" : "Fixed"} per tournament:`);
    for (const [tid, count] of fixedByTournament) {
      const t = await loadTournament(tid);
      console.log(`    ${String(count).padStart(4)} × ${t?.title || "(unknown)"} [${tid}]`);
    }
  }
  if (DRY_RUN) console.log(`\n  Re-run without --dry to apply.`);

  await mongoose.disconnect();
})().catch((e) => {
  console.error("✗ Repair failed:", e);
  process.exit(1);
});
