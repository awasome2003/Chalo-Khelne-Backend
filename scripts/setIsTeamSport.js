// One-off backfill: set Sport.isTeamSport=true for every sport whose category
// is "Team". Run once after the schema change in Modal/Sport.js. Safe to re-run
// (idempotent — only sets the field; never unsets).
//
//   node scripts/setIsTeamSport.js
//
// Requires MONGO_URI in env (or a local .env loaded automatically).

require("dotenv").config();
const mongoose = require("mongoose");
const Sport = require("../Modal/Sport");

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("[setIsTeamSport] MONGO_URI not set. Aborting.");
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log("[setIsTeamSport] Connected.");

  const result = await Sport.updateMany(
    { category: "Team", isTeamSport: { $ne: true } },
    { $set: { isTeamSport: true } }
  );
  console.log(
    `[setIsTeamSport] Matched ${result.matchedCount}, modified ${result.modifiedCount} team-category sports.`
  );

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error("[setIsTeamSport] Error:", err);
  process.exit(1);
});
