// server/scripts/auditOrphanReachability.js
//
// STEP 17f Check 2 — verify every orphan child doc (sportId: null)
// references a Tournament that no longer exists in the DB. If any
// orphan's parent IS in the surviving tournaments, our orphan
// classification is wrong and 17f required:true flips would block.

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const ep = [path.join(__dirname, "..", ".env"), path.join(__dirname, "..", "..", ".env")];
for (const p of ep) if (fs.existsSync(p)) { dotenv.config({ path: p }); break; }

const mongoose = require("mongoose");

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) { console.error("MONGO_URI not set"); process.exit(1); }
  await mongoose.connect(uri);

  const Tournament = require("../src/modules/tournaments/models/Tournament");
  const Match = require("../src/modules/tournaments/models/Tournnamentmatch");
  const BookingGroup = require("../src/modules/tournaments/models/bookinggroup");
  const TopPlayers = require("../src/modules/tournaments/models/TopPlayers");
  const GroupStandings = require("../src/modules/tournaments/models/GroupStandings");

  // Collect surviving tournament _ids.
  const aliveTournaments = await Tournament.find({}).select("_id").lean();
  const aliveIds = new Set(aliveTournaments.map((t) => String(t._id)));
  console.log(`Alive tournament count: ${aliveIds.size}`);

  const collections = [
    { name: "Tournnamentmatch", model: Match },
    { name: "bookinggroup",      model: BookingGroup },
    { name: "TopPlayers",        model: TopPlayers },
    { name: "GroupStandings",    model: GroupStandings },
  ];

  const result = { totalOrphans: 0, falseOrphans: 0, byCollection: {} };

  for (const { name, model } of collections) {
    const orphans = await model
      .find({ $or: [{ sportId: { $exists: false } }, { sportId: null }] })
      .select("_id tournamentId")
      .lean();

    let referencingAlive = 0;
    let referencingDead = 0;
    const aliveSamples = [];

    for (const o of orphans) {
      const tid = o.tournamentId ? String(o.tournamentId) : null;
      if (!tid) {
        // No tournamentId at all — corrupt; treat as dead.
        referencingDead++;
        continue;
      }
      if (aliveIds.has(tid)) {
        referencingAlive++;
        if (aliveSamples.length < 5) {
          aliveSamples.push({ docId: String(o._id), tournamentId: tid });
        }
      } else {
        referencingDead++;
      }
    }

    result.totalOrphans += orphans.length;
    result.falseOrphans += referencingAlive;
    result.byCollection[name] = {
      total: orphans.length,
      referencingAliveTournament: referencingAlive,
      referencingDeadTournament: referencingDead,
      aliveSamples,
    };

    console.log(`\n${name}: ${orphans.length} orphans`);
    console.log(`  → referencing ALIVE tournament: ${referencingAlive}`);
    console.log(`  → referencing DEAD/missing parent: ${referencingDead}`);
    if (aliveSamples.length > 0) {
      console.log(`  ⚠️  Live-parent orphan samples (would block 17f):`);
      for (const s of aliveSamples) {
        console.log(`     doc=${s.docId}  tournamentId=${s.tournamentId}`);
      }
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Total orphans across 4 collections: ${result.totalOrphans}`);
  console.log(`False orphans (parent IS alive — would BLOCK 17f): ${result.falseOrphans}`);
  console.log(`Confirmed orphans (parent deleted — safe for 17f): ${result.totalOrphans - result.falseOrphans}`);

  if (result.falseOrphans === 0) {
    console.log("\n✓ CLEAN: every orphan's parent tournament is gone. 17f required:true flips are safe.");
  } else {
    console.log("\n✗ BLOCKED: " + result.falseOrphans + " 'orphans' have live parents — they're not actually orphans.");
    console.log("   These docs MUST be backfilled with sportId before 17f.");
  }

  const logPath = path.join(__dirname, "audit-orphan-reachability.log");
  fs.writeFileSync(logPath, JSON.stringify(result, null, 2));
  console.log(`\nLog: ${logPath}`);

  await mongoose.disconnect();
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
