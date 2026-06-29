#!/usr/bin/env node
/**
 * DECOMMISSIONED in STEP 17b.iii.
 * This script queries `{ sportsType: { $in: FLAT_SET_SPORTS } }` against
 * the Tournament collection — root sportsType is removed in 17g, after
 * which this script returns zero matches and is functionally dead.
 * Kept only for git-history reference. Do not run.
 *
 * ─── Original header ───
 * Migration: Normalize matchFormat for flat-set sports.
 *
 * Context:
 *   After the flat-set refactor (Option A), match docs for Table Tennis,
 *   Badminton, Volleyball, Squash, and Pickleball should have:
 *     matchFormat.gamesToWin   = null
 *     matchFormat.maxGames     = null
 *     matchFormat.totalGames   -> removed
 *     matchFormat.gamesPerSet  -> removed
 *
 *   Existing docs were saved with the old 4-level shape (gamesToWin: 3,
 *   maxGames: 5, etc.). This script normalizes them.
 *
 *   NOTE: sets[].games[] arrays are intentionally NOT touched (phase 3 skipped
 *   per migration plan). Completed matches already have correct final results
 *   in match.result.finalScore.
 *
 * Usage:
 *   node scripts/migrateFlatSets.js --dry-run    # show what would change, no writes
 *   node scripts/migrateFlatSets.js --apply      # create backups + run writes (prompts for confirmation)
 */

"use strict";

const path = require("path");
const readline = require("readline");
const mongoose = require("mongoose");

// Load .env from server/ root, exactly like server.js does.
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

// Require models so their collection names are registered with Mongoose.
const Match = require("../src/modules/tournaments/models/Tournnamentmatch");
const DirectKnockoutMatch = require("../src/modules/tournaments/models/DirectKnockoutMatch");

// --- Config ---------------------------------------------
const FLAT_SET_SPORTS = [
  "Table Tennis",
  "Badminton",
  "Volleyball",
  "Squash",
  "Pickleball",
];

const TARGETS = [
  { label: "Match (group-stage/legacy)", model: Match },
  { label: "DirectKnockoutMatch", model: DirectKnockoutMatch },
];

// --- CLI flags ------------------------------------------
const argv = process.argv.slice(2);
const MODE =
  argv.includes("--apply") ? "apply" :
  argv.includes("--dry-run") ? "dry-run" :
  null;

if (!MODE) {
  console.error("Usage: node scripts/migrateFlatSets.js --dry-run | --apply");
  process.exit(1);
}

// --- Helpers --------------------------------------------
function todayStamp() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function needsUpdateFilter() {
  // A doc needs update if its matchFormat has any non-normalized field.
  return {
    $and: [
      {
        $or: [
          { sportsType: { $in: FLAT_SET_SPORTS } },
          { sportName: { $in: FLAT_SET_SPORTS } },
        ],
      },
      {
        $or: [
          { "matchFormat.gamesToWin": { $exists: true, $ne: null } },
          { "matchFormat.maxGames":   { $exists: true, $ne: null } },
          { "matchFormat.totalGames":  { $exists: true } },
          { "matchFormat.gamesPerSet": { $exists: true } },
        ],
      },
    ],
  };
}

function flatSetFilter() {
  return {
    $or: [
      { sportsType: { $in: FLAT_SET_SPORTS } },
      { sportName: { $in: FLAT_SET_SPORTS } },
    ],
  };
}

const UPDATE_OP = {
  $set: {
    "matchFormat.gamesToWin": null,
    "matchFormat.maxGames": null,
  },
  $unset: {
    "matchFormat.totalGames": "",
    "matchFormat.gamesPerSet": "",
  },
};

async function confirm(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(String(answer || "").trim().toLowerCase());
    });
  });
}

async function inventoryOne(model) {
  const col = model.collection;
  const perSport = {};
  for (const sport of FLAT_SET_SPORTS) {
    perSport[sport] = await col.countDocuments({
      $or: [{ sportsType: sport }, { sportName: sport }],
    });
  }
  const total = await col.countDocuments(flatSetFilter());
  const needsUpdate = await col.countDocuments(needsUpdateFilter());
  return { perSport, total, needsUpdate, alreadyNormalized: total - needsUpdate };
}

function printInventory(label, inv) {
  console.log(`\n  Collection: ${label}`);
  console.log(`    Per-sport counts:`);
  let anyCount = false;
  for (const [sport, count] of Object.entries(inv.perSport)) {
    if (count > 0) {
      console.log(`      * ${sport}: ${count}`);
      anyCount = true;
    }
  }
  if (!anyCount) console.log(`      (none)`);
  console.log(`    Total flat-set docs:     ${inv.total}`);
  console.log(`    Needs update:            ${inv.needsUpdate}`);
  console.log(`    Already normalized:      ${inv.alreadyNormalized}`);
}

async function backupCollection(db, srcName, backupName) {
  // $out replaces backupName if it already exists.
  await db
    .collection(srcName)
    .aggregate([{ $match: {} }, { $out: backupName }], { allowDiskUse: true })
    .toArray();
}

async function applyMigration(model) {
  const res = await model.collection.updateMany(needsUpdateFilter(), UPDATE_OP);
  return { matched: res.matchedCount, modified: res.modifiedCount };
}

// --- Main -----------------------------------------------
async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI not set in .env -- cannot connect.");
    process.exit(1);
  }

  console.log(`\n========================================================`);
  console.log(`  Flat-set match migration -- mode: ${MODE.toUpperCase()}`);
  console.log(`========================================================`);

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  console.log(`  Connected to database: ${db.databaseName}\n`);

  // Inventory pass
  const reports = [];
  for (const t of TARGETS) {
    const inv = await inventoryOne(t.model);
    reports.push({ ...t, inv });
    printInventory(t.label, inv);
  }

  const totalToUpdate = reports.reduce((s, r) => s + r.inv.needsUpdate, 0);
  console.log(`\n  --------------------------------------------------------`);
  console.log(`  TOTAL docs that would be updated: ${totalToUpdate}`);

  if (MODE === "dry-run") {
    console.log(`\n[DRY-RUN] No writes performed. Re-run with --apply to execute.\n`);
    await mongoose.disconnect();
    return;
  }

  // APPLY mode
  if (totalToUpdate === 0) {
    console.log(`\nNothing to migrate -- all flat-set docs are already normalized.\n`);
    await mongoose.disconnect();
    return;
  }

  const stamp = todayStamp();
  console.log(`\n[APPLY] About to:`);
  console.log(`  1. Back up each affected collection to <collection>_backup_${stamp}`);
  console.log(`  2. Set matchFormat.gamesToWin = null, matchFormat.maxGames = null`);
  console.log(`  3. Unset matchFormat.totalGames, matchFormat.gamesPerSet`);
  console.log(`  4. Scope: ${FLAT_SET_SPORTS.join(", ")}`);
  console.log(`  (sets[].games[] arrays are NOT touched.)`);

  const answer = await confirm(`\nProceed? (type "yes" to continue): `);
  if (answer !== "yes") {
    console.log("Aborted. No changes made.");
    await mongoose.disconnect();
    return;
  }

  for (const r of reports) {
    if (r.inv.needsUpdate === 0) {
      console.log(`\n  ${r.label}: nothing to do.`);
      continue;
    }
    const collName = r.model.collection.name;
    const backupName = `${collName}_backup_${stamp}`;
    console.log(`\n  ${r.label}:`);
    console.log(`    Backing up ${collName} -> ${backupName} ...`);
    await backupCollection(db, collName, backupName);
    const backupCount = await db.collection(backupName).countDocuments();
    console.log(`    Backup created: ${backupCount} docs in ${backupName}`);

    console.log(`    Running updateMany ...`);
    const res = await applyMigration(r.model);
    console.log(`    Matched: ${res.matched}  Modified: ${res.modified}`);
  }

  console.log(`\n======= Migration complete. =======\n`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("\nMigration failed:", err);
  try { await mongoose.disconnect(); } catch (_) { /* ignore */ }
  process.exit(1);
});
