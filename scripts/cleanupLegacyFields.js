// server/scripts/cleanupLegacyFields.js
//
// STEP 17g — DB cleanup migration. **IRREVERSIBLE.**
//
// What it does:
//   1. $unset 13 deprecated root fields on every Tournament doc:
//      type, currentStage, qualifyPerGroup, drawSize, davisCupFormatId,
//      sportsType, sportRules, groupStageFormat, knockoutFormat,
//      category, setFormat, matchFormat, stageConfig.
//   2. $unset `selectedCategories` on every Booking doc that has it.
//   3. Delete orphan child docs (sportId: null) across 4 collections:
//      Tournnamentmatch, bookinggroup, TopPlayers, GroupStandings.
//      (KnockoutMatch + SuperMatch + DirectKnockoutMatch + SuperPlayers
//      have 0 orphans per audit; included as no-op for completeness.)
//
// IMPORTANT (production):
//   1. API offline. (User-confirmed.)
//   2. Fresh `mongodump` snapshot. (User-confirmed.)
//   3. Run `--dry-run` first; review counts.
//   4. If counts match expected, run for real.
//   5. Re-audit after.
//
// Usage:
//   node server/scripts/cleanupLegacyFields.js --dry-run
//   node server/scripts/cleanupLegacyFields.js
//
// Idempotent — safe to re-run (subsequent runs touch 0 docs).

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const ep = [path.join(__dirname, "..", ".env"), path.join(__dirname, "..", "..", ".env")];
for (const p of ep) if (fs.existsSync(p)) { dotenv.config({ path: p }); break; }

const mongoose = require("mongoose");

const DRY = process.argv.includes("--dry-run");
const TAG = DRY ? "[DRY-RUN]" : "[REAL]";

const TOURNAMENT_LEGACY_FIELDS = [
  "type",
  "currentStage",
  "qualifyPerGroup",
  "drawSize",
  "davisCupFormatId",
  "sportsType",
  "sportRules",
  "groupStageFormat",
  "knockoutFormat",
  "category",
  "setFormat",
  "matchFormat",
  "stageConfig",
];

const ORPHAN_CRITERIA = {
  $or: [{ sportId: { $exists: false } }, { sportId: null }],
};

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) { console.error("MONGO_URI not set"); process.exit(1); }
  await mongoose.connect(uri);

  // Use raw collection access — schema strict mode would block reads/writes
  // of undeclared fields like `sportsType`, `category`, etc. (those got
  // removed from the Tournament schema in 17e). $unset MUST go through
  // the raw collection driver, NOT Mongoose validation.
  const db = mongoose.connection.db;

  // Resolve collection names via Mongoose models (handles pluralization).
  const Tournament = require("../Modal/Tournament");
  const Booking = require("../Modal/BookingModel");
  const Match = require("../Modal/Tournnamentmatch");
  const BookingGroup = require("../Modal/bookinggroup");
  const TopPlayers = require("../Modal/TopPlayers");
  const GroupStandings = require("../Modal/GroupStandings");
  const KnockoutMatch = require("../Modal/KnockoutMatch");
  const SuperMatch = require("../Modal/SuperMatch");
  const DirectKnockoutMatch = require("../Modal/DirectKnockoutMatch");
  const SuperPlayers = require("../Modal/SuperPlayers");
  const TOURNAMENT_COLL = Tournament.collection.name;
  const BOOKING_COLL = Booking.collection.name;
  console.log(`${TAG} Resolved collections via Mongoose: tournaments="${TOURNAMENT_COLL}", bookings="${BOOKING_COLL}"`);

  const log = {
    startedAt: new Date().toISOString(),
    dryRun: DRY,
    results: {},
  };

  console.log(`\n${TAG} Starting cleanup at ${log.startedAt}`);

  // ──────────────────────────────────────────────────────────
  // 1) Tournament $unset of 13 legacy root fields
  // ──────────────────────────────────────────────────────────
  const tColl = db.collection(TOURNAMENT_COLL);
  const tournamentLegacyMatch = {
    $or: TOURNAMENT_LEGACY_FIELDS.map((f) => ({ [f]: { $exists: true } })),
  };
  const tournamentsWithLegacy = await tColl.countDocuments(tournamentLegacyMatch);
  console.log(`\n${TAG} Tournaments with at least one legacy field: ${tournamentsWithLegacy}`);

  const unsetSpec = {};
  for (const f of TOURNAMENT_LEGACY_FIELDS) unsetSpec[f] = "";

  if (DRY) {
    log.results.tournaments = { wouldTouch: tournamentsWithLegacy, fields: TOURNAMENT_LEGACY_FIELDS };
  } else {
    const r = await tColl.updateMany({}, { $unset: unsetSpec });
    log.results.tournaments = { matched: r.matchedCount, modified: r.modifiedCount };
    console.log(`${TAG} Tournament $unset: matched=${r.matchedCount} modified=${r.modifiedCount}`);
  }

  // ──────────────────────────────────────────────────────────
  // 2) Booking $unset of selectedCategories
  // ──────────────────────────────────────────────────────────
  const bColl = db.collection(BOOKING_COLL);
  const bookingsWithLegacy = await bColl.countDocuments({ selectedCategories: { $exists: true } });
  console.log(`\n${TAG} Bookings with selectedCategories field: ${bookingsWithLegacy}`);

  if (DRY) {
    log.results.bookings = { wouldTouch: bookingsWithLegacy };
  } else {
    const r = await bColl.updateMany({}, { $unset: { selectedCategories: "" } });
    log.results.bookings = { matched: r.matchedCount, modified: r.modifiedCount };
    console.log(`${TAG} Booking $unset: matched=${r.matchedCount} modified=${r.modifiedCount}`);
  }

  // ──────────────────────────────────────────────────────────
  // 3) Delete orphans across 4 collections (sportId: null/missing)
  // ──────────────────────────────────────────────────────────
  const orphanCollections = [
    { name: "Tournnamentmatch (group stage)", coll: Match.collection.name },
    { name: "bookinggroup",                   coll: BookingGroup.collection.name },
    { name: "TopPlayers",                     coll: TopPlayers.collection.name },
    { name: "GroupStandings",                 coll: GroupStandings.collection.name },
  ];
  // Belt-and-suspenders empty collections (audit shows 0 orphans):
  const safetyCollections = [
    { name: "KnockoutMatch",        coll: KnockoutMatch.collection.name },
    { name: "SuperMatch",           coll: SuperMatch.collection.name },
    { name: "DirectKnockoutMatch",  coll: DirectKnockoutMatch.collection.name },
    { name: "SuperPlayers",         coll: SuperPlayers.collection.name },
  ];
  const allOrphanColls = [...orphanCollections, ...safetyCollections];

  log.results.orphans = {};
  for (const { name, coll } of allOrphanColls) {
    const c = db.collection(coll);
    const count = await c.countDocuments(ORPHAN_CRITERIA);
    if (DRY) {
      console.log(`${TAG} ${name}: ${count} orphans (would delete)`);
      log.results.orphans[name] = { wouldDelete: count };
    } else {
      const r = await c.deleteMany(ORPHAN_CRITERIA);
      console.log(`${TAG} ${name}: ${count} orphans → deleted=${r.deletedCount}`);
      log.results.orphans[name] = { matched: count, deleted: r.deletedCount };
    }
  }

  // ──────────────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────────────
  log.completedAt = new Date().toISOString();
  console.log(`\n${TAG} Summary:`);
  console.log(`  Tournaments touched:   ${DRY ? log.results.tournaments.wouldTouch : log.results.tournaments.modified}`);
  console.log(`  Bookings touched:      ${DRY ? log.results.bookings.wouldTouch : log.results.bookings.modified}`);
  let totalOrphans = 0;
  for (const k of Object.keys(log.results.orphans)) {
    const v = log.results.orphans[k];
    totalOrphans += DRY ? v.wouldDelete : v.deleted;
  }
  console.log(`  Orphans deleted:       ${totalOrphans}`);

  const logPath = path.join(__dirname, DRY ? "cleanup-legacy-fields.dryrun.log" : "cleanup-legacy-fields.log");
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
  console.log(`${TAG} Log: ${logPath}`);

  await mongoose.disconnect();
  console.log(`${TAG} Done.`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
