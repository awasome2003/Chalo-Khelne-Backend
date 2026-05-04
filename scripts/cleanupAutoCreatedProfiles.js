#!/usr/bin/env node
/**
 * Cleanup: delete auto-created Trainer/Referee profiles that were never edited,
 * for users whose User.role === "Player".
 *
 * Context: before the opt-in auto-create fix, the backend would silently create
 * Trainer and Referee docs whenever the mobile RoleHub probed those GET endpoints
 * for a Player. This script removes that pollution.
 *
 * Criteria (strict):
 *   Trainer: certificates=[], sports=[], languages=[], experience=0, AND owner role=Player
 *   Referee: certificates=[], experience=0, AND owner role=Player
 *
 * Usage:
 *   node scripts/cleanupAutoCreatedProfiles.js --dry-run
 *   node scripts/cleanupAutoCreatedProfiles.js --apply
 */

"use strict";

const path = require("path");
const readline = require("readline");
const mongoose = require("mongoose");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const Trainer = require("../Modal/Trainer");
const Referee = require("../Modal/Referee");
require("../Modal/User"); // ensure model is registered

// --- CLI flags ------------------------------------------
const argv = process.argv.slice(2);
const MODE =
  argv.includes("--apply") ? "apply" :
  argv.includes("--dry-run") ? "dry-run" :
  null;

if (!MODE) {
  console.error("Usage: node scripts/cleanupAutoCreatedProfiles.js --dry-run | --apply");
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

async function confirm(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(String(answer || "").trim().toLowerCase());
    });
  });
}

const TRAINER_EMPTY = {
  certificates: { $size: 0 },
  sports: { $size: 0 },
  languages: { $size: 0 },
  experience: 0,
};
const REFEREE_EMPTY = {
  certificates: { $size: 0 },
  experience: 0,
};

async function findCandidates(col, emptyCriteria) {
  return col.aggregate([
    { $match: emptyCriteria },
    {
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "_user",
      },
    },
    { $unwind: "$_user" },
    { $match: { "_user.role": "Player" } },
    {
      $project: {
        _id: 1,
        userId: 1,
        firstName: 1,
        lastName: 1,
        userName: "$_user.name",
        userEmail: "$_user.email",
      },
    },
  ]).toArray();
}

function printSample(label, candidates) {
  console.log(`\n  ${label}: ${candidates.length}`);
  if (candidates.length === 0) return;
  const sample = candidates.slice(0, 5);
  for (const c of sample) {
    console.log(`    - ${c.userName || "?"} <${c.userEmail || "?"}> (userId=${c.userId}, profileId=${c._id})`);
  }
  if (candidates.length > 5) console.log(`    ... and ${candidates.length - 5} more`);
}

async function backupCollection(db, srcName, backupName) {
  await db
    .collection(srcName)
    .aggregate([{ $match: {} }, { $out: backupName }], { allowDiskUse: true })
    .toArray();
}

// --- Main -----------------------------------------------
async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI not set in .env -- cannot connect.");
    process.exit(1);
  }

  console.log(`\n============================================================`);
  console.log(`  Cleanup auto-created Trainer/Referee profiles -- mode: ${MODE.toUpperCase()}`);
  console.log(`============================================================`);

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  console.log(`  Connected to database: ${db.databaseName}\n`);

  const trainerCol = Trainer.collection;
  const refereeCol = Referee.collection;

  const trainerCandidates = await findCandidates(trainerCol, TRAINER_EMPTY);
  const refereeCandidates = await findCandidates(refereeCol, REFEREE_EMPTY);

  printSample("Trainer candidates (empty + owner role=Player)", trainerCandidates);
  printSample("Referee candidates (empty + owner role=Player)", refereeCandidates);

  const total = trainerCandidates.length + refereeCandidates.length;
  console.log(`\n  ------------------------------------------------------------`);
  console.log(`  TOTAL candidates to delete: ${total}`);

  if (MODE === "dry-run") {
    console.log(`\n[DRY-RUN] No writes. Re-run with --apply to delete.\n`);
    await mongoose.disconnect();
    return;
  }

  if (total === 0) {
    console.log(`\nNothing to clean up -- all good.\n`);
    await mongoose.disconnect();
    return;
  }

  const stamp = todayStamp();
  console.log(`\n[APPLY] About to:`);
  if (trainerCandidates.length > 0) {
    console.log(`  1. Back up ${trainerCol.collectionName} -> trainers_backup_${stamp}`);
    console.log(`     Delete ${trainerCandidates.length} Trainer profiles`);
  }
  if (refereeCandidates.length > 0) {
    console.log(`  2. Back up ${refereeCol.collectionName} -> referees_backup_${stamp}`);
    console.log(`     Delete ${refereeCandidates.length} Referee profiles`);
  }
  console.log(`  Criteria: all default-empty fields AND owner User.role === "Player"`);

  const answer = await confirm(`\nProceed? (type "yes" to continue): `);
  if (answer !== "yes") {
    console.log("Aborted. No changes made.");
    await mongoose.disconnect();
    return;
  }

  if (trainerCandidates.length > 0) {
    const backupName = `trainers_backup_${stamp}`;
    console.log(`\n  Backing up ${trainerCol.collectionName} -> ${backupName} ...`);
    await backupCollection(db, trainerCol.collectionName, backupName);
    const bkCount = await db.collection(backupName).countDocuments();
    console.log(`  Backup: ${bkCount} docs in ${backupName}`);

    const ids = trainerCandidates.map(c => c._id);
    const res = await trainerCol.deleteMany({ _id: { $in: ids } });
    console.log(`  Deleted: ${res.deletedCount} Trainer profiles`);
  }

  if (refereeCandidates.length > 0) {
    const backupName = `referees_backup_${stamp}`;
    console.log(`\n  Backing up ${refereeCol.collectionName} -> ${backupName} ...`);
    await backupCollection(db, refereeCol.collectionName, backupName);
    const bkCount = await db.collection(backupName).countDocuments();
    console.log(`  Backup: ${bkCount} docs in ${backupName}`);

    const ids = refereeCandidates.map(c => c._id);
    const res = await refereeCol.deleteMany({ _id: { $in: ids } });
    console.log(`  Deleted: ${res.deletedCount} Referee profiles`);
  }

  console.log(`\n======= Cleanup complete. =======\n`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("\nCleanup failed:", err);
  try { await mongoose.disconnect(); } catch (_) { /* ignore */ }
  process.exit(1);
});
