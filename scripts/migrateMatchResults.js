#!/usr/bin/env node
/**
 * Migration Script: Populate matchResult for ALL existing matches.
 *
 * Reads legacy data (sets/finalScore/winner) and converts into the
 * normalized matchResult structure used by readMatchResult().
 *
 * Usage:
 *   node scripts/migrateMatchResults.js              # DRY RUN (default)
 *   node scripts/migrateMatchResults.js --execute     # Actually write to DB
 *   node scripts/migrateMatchResults.js --execute --verbose
 *
 * Supports: Match, DirectKnockoutMatch, SuperMatch
 */

const mongoose = require("mongoose");
const path = require("path");

// ── Parse CLI args ──
const args = process.argv.slice(2);
const DRY_RUN = !args.includes("--execute");
const VERBOSE = args.includes("--verbose");

// ── Load models ──
const Match = require(path.join(__dirname, "../Modal/Tournnamentmatch"));
const DirectKnockoutMatch = require(path.join(__dirname, "../Modal/DirectKnockoutMatch"));
const SuperMatch = require(path.join(__dirname, "../Modal/SuperMatch"));
const Tournament = require(path.join(__dirname, "../Modal/Tournament"));
const { getScoringType } = require(path.join(__dirname, "../utils/matchFormatUtils"));

// ── Stats ──
const stats = {
  total: 0,
  migrated: 0,
  skipped: 0,
  alreadyHasResult: 0,
  failures: [],
};

/**
 * Build normalized matchResult from legacy match data.
 */
function buildMatchResult(match, scoringType) {
  const type = scoringType || "sets";

  // Extract winner
  let winner = null;
  if (match.result?.winner?.playerId) {
    winner = { playerId: match.result.winner.playerId, playerName: match.result.winner.playerName || null };
  } else if (match.winner?.playerId) {
    winner = { playerId: match.winner.playerId, playerName: match.winner.playerName || null };
  }

  // Extract scores
  let player1Score = 0, player2Score = 0;
  if (match.result?.finalScore) {
    player1Score = match.result.finalScore.player1Sets || 0;
    player2Score = match.result.finalScore.player2Sets || 0;
  } else if (match.score) {
    player1Score = match.score.player1Sets || 0;
    player2Score = match.score.player2Sets || 0;
  }

  // For non-set sports stored in 1-set-1-game format, extract game scores
  let details = [];
  if (type === "sets" && match.sets?.length > 0) {
    details = match.sets.map(s => ({
      roundNumber: s.setNumber,
      status: s.status,
      subRounds: (s.games || []).map(g => ({
        number: g.gameNumber,
        player1Score: g.finalScore?.player1 ?? 0,
        player2Score: g.finalScore?.player2 ?? 0,
      })),
    }));
  } else if (match.sets?.length > 0 && match.sets[0]?.games?.length > 0) {
    const g = match.sets[0].games[0];
    details = [{ player1Score: g.finalScore?.player1 ?? 0, player2Score: g.finalScore?.player2 ?? 0 }];
  }

  const completed = (match.status || "").toUpperCase() === "COMPLETED";

  return {
    type,
    completed,
    player1Score,
    player2Score,
    winner,
    details,
    migratedAt: new Date(),
  };
}

/**
 * Migrate all matches in a given model.
 */
async function migrateModel(Model, modelName) {
  const allMatches = await Model.find({}).lean(false);
  console.log(`\n── ${modelName}: ${allMatches.length} matches ──`);

  // Pre-load tournament sportsType cache
  const tournamentCache = {};

  for (const match of allMatches) {
    stats.total++;

    try {
      // Skip if already has matchResult
      if (match.matchResult && match.matchResult.type) {
        stats.alreadyHasResult++;
        if (VERBOSE) console.log(`  [SKIP] ${match._id} — already has matchResult`);
        continue;
      }

      // Skip non-completed matches (only migrate completed ones)
      if ((match.status || "").toUpperCase() !== "COMPLETED") {
        stats.skipped++;
        if (VERBOSE) console.log(`  [SKIP] ${match._id} — status: ${match.status}`);
        continue;
      }

      // Detect scoringType
      let scoringType = match.matchFormat?.scoringType || null;

      if (!scoringType && match.tournamentId) {
        const tid = match.tournamentId.toString();
        if (!tournamentCache[tid]) {
          const t = await Tournament.findById(tid).select("sportsType matchFormat").lean();
          tournamentCache[tid] = t;
        }
        const tournament = tournamentCache[tid];
        scoringType = tournament?.matchFormat?.scoringType
          || getScoringType(match.sportsType || tournament?.sportsType)
          || "sets";
      }

      if (!scoringType) scoringType = "sets"; // Legacy fallback for migration only

      // Build normalized result
      const matchResult = buildMatchResult(match, scoringType);

      if (VERBOSE) {
        console.log(`  [MIGRATE] ${match._id} → type:${matchResult.type} score:${matchResult.player1Score}-${matchResult.player2Score}`);
      }

      if (!DRY_RUN) {
        await Model.updateOne(
          { _id: match._id },
          { $set: { matchResult } }
        );
      }

      stats.migrated++;
    } catch (err) {
      stats.failures.push({ matchId: match._id?.toString(), model: modelName, error: err.message });
      console.error(`  [FAIL] ${match._id}: ${err.message}`);
    }
  }
}

/**
 * Main entry point.
 */
async function main() {
  console.log("╔════════════════════════════════════════════════════╗");
  console.log("║  Match Result Migration Script                    ║");
  console.log(`║  Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "EXECUTE (writing to DB)"}              ║`);
  console.log("╚════════════════════════════════════════════════════╝\n");

  // Connect to MongoDB
  const dbUri = process.env.MONGO_URI || "mongodb://localhost:27017/sportapp";
  console.log(`Connecting to: ${dbUri.replace(/\/\/[^@]*@/, "//***@")}`);
  await mongoose.connect(dbUri);
  console.log("Connected.\n");

  // Migrate each model
  await migrateModel(Match, "Match (Group Stage)");
  await migrateModel(DirectKnockoutMatch, "DirectKnockoutMatch");
  await migrateModel(SuperMatch, "SuperMatch");

  // Summary
  console.log("\n╔════════════════════════════════════════════════════╗");
  console.log("║  MIGRATION SUMMARY                                ║");
  console.log("╚════════════════════════════════════════════════════╝");
  console.log(`  Total matches scanned:  ${stats.total}`);
  console.log(`  Already had matchResult: ${stats.alreadyHasResult}`);
  console.log(`  Skipped (not completed): ${stats.skipped}`);
  console.log(`  Migrated:               ${stats.migrated}`);
  console.log(`  Failures:               ${stats.failures.length}`);

  if (stats.failures.length > 0) {
    console.log("\n  Failed matches:");
    stats.failures.forEach(f => console.log(`    - ${f.model} ${f.matchId}: ${f.error}`));
  }

  if (DRY_RUN) {
    console.log("\n  ⚠ DRY RUN — no changes written. Run with --execute to apply.");
  } else {
    console.log("\n  ✓ Migration complete. All changes written to database.");
  }

  await mongoose.disconnect();
  process.exit(stats.failures.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
