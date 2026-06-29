// server/scripts/backfillFalseOrphanStandings.js
//
// STEP 17f remediation #1 — backfill the 10 GroupStandings docs that
// have null sportId but reference an alive Tournament. These docs would
// fail Mongoose required:true validation after 17f.
//
// Cause: standings.groupId points to a BookingGroup that doesn't exist
// (BG was deleted, standings stayed). The migration script's
// GroupStandings cascade (line 240-280 of migrateToMultiSport.js) skips
// standings whose BG lookup returns null, leaving sportId at null.
//
// Fix: resolve sportId from Tournament.sports[0].sportId. Single-sport
// tournaments (which these are) have unambiguous primary sport.
//
// Usage:
//   node server/scripts/backfillFalseOrphanStandings.js --dry-run
//   node server/scripts/backfillFalseOrphanStandings.js
//
// Idempotent — safe to re-run.

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const ep = [path.join(__dirname, "..", ".env"), path.join(__dirname, "..", "..", ".env")];
for (const p of ep) if (fs.existsSync(p)) { dotenv.config({ path: p }); break; }

const mongoose = require("mongoose");

const DRY = process.argv.includes("--dry-run");
const TAG = DRY ? "[DRY-RUN]" : "[REAL]";

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) { console.error("MONGO_URI not set"); process.exit(1); }
  await mongoose.connect(uri);

  const Tournament = require("../src/modules/tournaments/models/Tournament");
  const GroupStandings = require("../src/modules/tournaments/models/GroupStandings");

  // 1) Find all standings with null sportId.
  const orphans = await GroupStandings.find({
    $or: [{ sportId: { $exists: false } }, { sportId: null }],
  }).select("_id tournamentId groupId").lean();

  // 2) Filter to those whose parent Tournament IS alive.
  const aliveIds = new Set(
    (await Tournament.find({}).select("_id").lean()).map((t) => String(t._id))
  );
  const falseOrphans = orphans.filter((o) =>
    o.tournamentId && aliveIds.has(String(o.tournamentId))
  );

  console.log(`${TAG} found ${orphans.length} null-sportId GroupStandings total`);
  console.log(`${TAG} ${falseOrphans.length} reference an alive parent (target set)`);

  if (falseOrphans.length === 0) {
    console.log(`${TAG} nothing to backfill.`);
    await mongoose.disconnect();
    return;
  }

  // 3) Group by tournamentId, look up sports[0].sportId per tournament.
  const byTournament = new Map();
  for (const o of falseOrphans) {
    const tid = String(o.tournamentId);
    if (!byTournament.has(tid)) byTournament.set(tid, []);
    byTournament.get(tid).push(o);
  }

  const log = { startedAt: new Date().toISOString(), dryRun: DRY, results: [] };
  let touched = 0;
  let skipped = 0;
  let errors = 0;

  for (const [tid, docs] of byTournament.entries()) {
    const tournament = await Tournament.findById(tid).select("sports title").lean();
    const primarySportId = tournament?.sports?.[0]?.sportId || null;
    const primarySportName = tournament?.sports?.[0]?.sportName || null;

    if (!primarySportId) {
      console.log(`${TAG} ⚠️  Tournament ${tid} (${tournament?.title}) has no sports[0].sportId — cannot backfill ${docs.length} docs`);
      skipped += docs.length;
      log.results.push({ tournamentId: tid, title: tournament?.title, docCount: docs.length, action: "skipped-no-sportId" });
      continue;
    }

    console.log(`${TAG} Tournament ${tid} (${tournament?.title}, sport=${primarySportName}) — backfilling ${docs.length} standings`);
    for (const o of docs) {
      console.log(`  - GroupStandings ${o._id} (groupId=${o.groupId})`);
    }

    if (DRY) {
      touched += docs.length;
    } else {
      try {
        const ids = docs.map((d) => d._id);
        const r = await GroupStandings.updateMany(
          { _id: { $in: ids } },
          { $set: { sportId: primarySportId } }
        );
        touched += r.modifiedCount || ids.length;
      } catch (err) {
        console.error(`${TAG} FAIL on tournament ${tid}:`, err.message);
        errors++;
      }
    }

    log.results.push({
      tournamentId: tid,
      title: tournament?.title,
      sportName: primarySportName,
      sportId: String(primarySportId),
      docCount: docs.length,
      action: DRY ? "would-touch" : "touched",
    });
  }

  log.completedAt = new Date().toISOString();
  log.summary = { touched, skipped, errors };

  console.log(`\n${TAG} Summary:`);
  console.log(`  touched=${touched}  skipped=${skipped}  errors=${errors}`);

  const logPath = path.join(__dirname, "backfill-false-orphan-standings.log");
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
  console.log(`${TAG} Log: ${logPath}`);

  await mongoose.disconnect();
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
