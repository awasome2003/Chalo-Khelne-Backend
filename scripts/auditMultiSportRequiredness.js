// server/scripts/auditMultiSportRequiredness.js
//
// STEP 16a — read-only audit. Counts documents that would FAIL a
// hypothetical `required: true` flip on sportId / sports[]. We are
// NOT flipping schema validators in STEP 16 (that's STEP 17); this
// just tells us whether boundary tightening (16b–16e) is safe.
//
// Action gate: any non-zero count means we need to backfill before
// rejecting writes against the affected tournaments — otherwise the
// system rejects edits to legacy docs that the same system created.
//
// Usage:
//   node server/scripts/auditMultiSportRequiredness.js
//
// Output:
//   - console summary
//   - server/scripts/audit-multi-sport-requiredness.log (JSON)

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const candidateEnvPaths = [
  path.join(__dirname, "..", ".env"),
  path.join(__dirname, "..", "..", ".env"),
];
let loadedEnv = null;
for (const p of candidateEnvPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    loadedEnv = p;
    break;
  }
}
if (!loadedEnv) dotenv.config();

const mongoose = require("mongoose");

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("[AUDIT-16a] MONGO_URI not set. Aborting.");
    process.exit(1);
  }

  console.log("\n[AUDIT-16a] STEP 16a — multi-sport requiredness audit");
  if (loadedEnv) console.log(`[AUDIT-16a] Loaded env from: ${loadedEnv}`);
  console.log("[AUDIT-16a] Connecting to MongoDB...");
  await mongoose.connect(uri);

  const Tournament = require("../Modal/Tournament");
  const Booking = require("../Modal/BookingModel");
  const Match = require("../Modal/Tournnamentmatch");
  const BookingGroup = require("../Modal/bookinggroup");
  const KnockoutMatch = require("../Modal/KnockoutMatch");
  const SuperMatch = require("../Modal/SuperMatch");
  const DirectKnockoutMatch = require("../Modal/DirectKnockoutMatch");
  const TopPlayers = require("../Modal/TopPlayers");
  const GroupStandings = require("../Modal/GroupStandings");
  const SuperPlayers = require("../Modal/SuperPlayers");

  // Predicate: sportId is missing or null. (Empty-string values cannot
  // exist on these collections — sportId is typed ObjectId.)
  const missingSport = {
    $or: [
      { sportId: { $exists: false } },
      { sportId: null },
    ],
  };

  const collections = [
    { label: "Tournnamentmatch (group stage)", model: Match },
    { label: "bookinggroup",                   model: BookingGroup },
    { label: "KnockoutMatch",                  model: KnockoutMatch },
    { label: "SuperMatch",                     model: SuperMatch },
    { label: "DirectKnockoutMatch",            model: DirectKnockoutMatch },
    { label: "TopPlayers",                     model: TopPlayers },
    { label: "GroupStandings",                 model: GroupStandings },
    { label: "SuperPlayers",                   model: SuperPlayers },
  ];

  const report = {
    startedAt: new Date().toISOString(),
    totals: {},
    samples: {},
    actionRequired: false,
  };

  // Tournament: sports[] empty/missing.
  const tournamentTotal = await Tournament.countDocuments({});
  const tournamentMissing = await Tournament.countDocuments({
    $or: [
      { sports: { $exists: false } },
      { sports: { $size: 0 } },
    ],
  });
  report.totals.Tournament = {
    total: tournamentTotal,
    missingSports: tournamentMissing,
  };
  if (tournamentMissing > 0) {
    report.actionRequired = true;
    const samples = await Tournament.find({
      $or: [
        { sports: { $exists: false } },
        { sports: { $size: 0 } },
      ],
    })
      .limit(10)
      .select("_id name sportsType")
      .lean();
    report.samples.Tournament = samples.map((t) => ({
      _id: String(t._id),
      name: t.name,
      sportsType: t.sportsType || null,
    }));
  }

  // Booking: sportSelections[] empty/missing — only count rows that
  // ALSO have selectedCategories (otherwise it's a truly empty booking,
  // intentionally not migrated per STEP 14 notes).
  const bookingTotal = await Booking.countDocuments({});
  const bookingMissing = await Booking.countDocuments({
    $and: [
      {
        $or: [
          { sportSelections: { $exists: false } },
          { sportSelections: { $size: 0 } },
        ],
      },
      { selectedCategories: { $exists: true, $not: { $size: 0 } } },
    ],
  });
  const bookingTrulyEmpty = await Booking.countDocuments({
    $and: [
      {
        $or: [
          { sportSelections: { $exists: false } },
          { sportSelections: { $size: 0 } },
        ],
      },
      {
        $or: [
          { selectedCategories: { $exists: false } },
          { selectedCategories: { $size: 0 } },
        ],
      },
    ],
  });
  report.totals.Booking = {
    total: bookingTotal,
    missingSportSelectionsLegacy: bookingMissing,
    trulyEmpty: bookingTrulyEmpty,
  };
  if (bookingMissing > 0) {
    report.actionRequired = true;
    const samples = await Booking.find({
      $and: [
        {
          $or: [
            { sportSelections: { $exists: false } },
            { sportSelections: { $size: 0 } },
          ],
        },
        { selectedCategories: { $exists: true, $not: { $size: 0 } } },
      ],
    })
      .limit(10)
      .select("_id tournamentId userId")
      .lean();
    report.samples.Booking = samples.map((b) => ({
      _id: String(b._id),
      tournamentId: String(b.tournamentId),
      userId: String(b.userId),
    }));
  }

  // Other 8 collections: sportId missing.
  for (const { label, model } of collections) {
    const total = await model.countDocuments({});
    const missing = await model.countDocuments(missingSport);
    report.totals[label] = { total, missingSportId: missing };
    if (missing > 0) {
      report.actionRequired = true;
      const samples = await model
        .find(missingSport)
        .limit(10)
        .select("_id tournamentId")
        .lean();
      report.samples[label] = samples.map((d) => ({
        _id: String(d._id),
        tournamentId: d.tournamentId ? String(d.tournamentId) : null,
      }));
    }
  }

  report.completedAt = new Date().toISOString();

  // Console summary.
  console.log("\n[AUDIT-16a] Results:");
  console.log("  Tournament:");
  console.log(
    `    total=${report.totals.Tournament.total}  missingSports[]=${report.totals.Tournament.missingSports}`
  );
  console.log("  Booking:");
  console.log(
    `    total=${report.totals.Booking.total}  missingSportSelections(legacy)=${report.totals.Booking.missingSportSelectionsLegacy}  trulyEmpty=${report.totals.Booking.trulyEmpty}`
  );
  for (const { label } of collections) {
    const t = report.totals[label];
    console.log(`  ${label}:`);
    console.log(`    total=${t.total}  missingSportId=${t.missingSportId}`);
  }
  console.log(
    `\n[AUDIT-16a] actionRequired (non-zero gaps): ${report.actionRequired}`
  );

  const logPath = path.join(__dirname, "audit-multi-sport-requiredness.log");
  fs.writeFileSync(logPath, JSON.stringify(report, null, 2));
  console.log(`[AUDIT-16a] Log written to ${logPath}`);

  await mongoose.disconnect();
  console.log("[AUDIT-16a] Done.");
}

main().catch((err) => {
  console.error("[AUDIT-16a] FATAL:", err);
  process.exit(1);
});
