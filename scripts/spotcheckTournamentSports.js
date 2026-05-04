// server/scripts/spotcheckTournamentSports.js
//
// One-shot read-only spot check. Picks a tournament whose `sports[]`
// is non-empty (i.e., one of the 7 already-migrated docs) and dumps
// the relevant fields so we can verify sports[0] was populated
// correctly — sportId resolved, sportName/sportSlug present,
// categories carried over from root, currentStage in valid enum.
//
// Optional arg: pass an _id to spot-check that specific tournament.
//   node server/scripts/spotcheckTournamentSports.js
//   node server/scripts/spotcheckTournamentSports.js 6960c80b...

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
    console.error("[SPOTCHECK] MONGO_URI not set. Aborting.");
    process.exit(1);
  }

  console.log("[SPOTCHECK] Connecting...");
  await mongoose.connect(uri);

  const Tournament = require("../Modal/Tournament");

  const argId = process.argv[2];
  let doc;
  if (argId) {
    doc = await Tournament
      .findById(argId)
      .select("_id name sportsType currentStage category sports")
      .lean();
  } else {
    doc = await Tournament
      .findOne({ sports: { $exists: true, $not: { $size: 0 } } })
      .select("_id name sportsType currentStage category sports")
      .lean();
  }

  if (!doc) {
    console.log("[SPOTCHECK] No tournament found with non-empty sports[].");
    await mongoose.disconnect();
    return;
  }

  console.log("\n[SPOTCHECK] Tournament:", String(doc._id));
  console.log("  name              :", doc.name);
  console.log("  legacy sportsType :", doc.sportsType);
  console.log("  legacy currentStage:", doc.currentStage);
  console.log(
    "  legacy category[].length :",
    Array.isArray(doc.category) ? doc.category.length : "(not array)"
  );
  console.log("\n  sports[]: (length=" + doc.sports.length + ")");
  doc.sports.forEach((s, i) => {
    console.log(`  [${i}]`);
    console.log("    sportId       :", s.sportId ? String(s.sportId) : null);
    console.log("    sportName     :", s.sportName);
    console.log("    sportSlug     :", s.sportSlug);
    console.log("    type          :", s.type);
    console.log("    currentStage  :", s.currentStage);
    console.log("    categories    :", JSON.stringify(s.categories));
    console.log("    qualifyPerGroup:", s.qualifyPerGroup);
    console.log("    drawSize      :", s.drawSize);
    console.log(
      "    matchFormat   :",
      s.matchFormat ? "(present)" : "(null/missing)"
    );
    console.log(
      "    sportRules    :",
      s.sportRules ? "(present)" : "(null/missing)"
    );
  });

  // Light consistency checks.
  const s0 = doc.sports[0];
  const ok = {
    hasSportId: !!s0?.sportId,
    hasSportName: !!s0?.sportName,
    hasCategories: Array.isArray(s0?.categories) && s0.categories.length > 0,
    legacyCategoriesCount: Array.isArray(doc.category) ? doc.category.length : 0,
    sportsCategoriesCount: Array.isArray(s0?.categories) ? s0.categories.length : 0,
  };
  console.log("\n[SPOTCHECK] Consistency:");
  console.log("  sports[0].sportId set        :", ok.hasSportId);
  console.log("  sports[0].sportName set      :", ok.hasSportName);
  console.log("  sports[0].categories non-empty:", ok.hasCategories);
  console.log(
    "  legacy category[] vs sports[0].categories: " +
    `${ok.legacyCategoriesCount} → ${ok.sportsCategoriesCount}`
  );

  await mongoose.disconnect();
  console.log("\n[SPOTCHECK] Done.");
}

main().catch((err) => {
  console.error("[SPOTCHECK] FATAL:", err);
  process.exit(1);
});
