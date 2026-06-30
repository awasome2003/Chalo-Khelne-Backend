/**
 * CSL 4.0 — seed the five league sports with the correct scoring config.
 * Idempotent (updates if the sport already exists). Read-only-safe to require
 * (guarded by require.main === module — never auto-runs).
 *
 *   node -r dotenv/config scripts/_seedCSLSports.js
 *
 * scoringType maps to the engine: "sets" (Badminton/TT/Pickle point games),
 * "board" (Carrom), "time" (Chess — scored by time consumed). isTeamSport is
 * FALSE — these are individual sports played in a TEAM competition via
 * Davis-Cup ties (see Config/teamKnockoutFormats.js csl_* presets).
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Sport = require("../src/modules/catalog/models/Sport");

const slugify = (s) => s.toLowerCase().trim().replace(/\s+/g, "-");

const CSL_SPORTS = [
  { name: "Badminton", category: "Racquet", scoringType: "sets", isTeamSport: false },
  { name: "Table Tennis", category: "Racquet", scoringType: "sets", isTeamSport: false },
  { name: "Carrom", category: "Board", scoringType: "board", isTeamSport: false },
  { name: "Chess", category: "Board", scoringType: "time", isTeamSport: false },
  { name: "Pickle Ball", category: "Racquet", scoringType: "sets", isTeamSport: false },
];

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set.");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  const report = [];
  for (const s of CSL_SPORTS) {
    const slug = slugify(s.name);
    const existing = await Sport.findOne({ $or: [{ slug }, { name: s.name }] });
    if (existing) {
      existing.category = s.category;
      existing.scoringType = s.scoringType;
      existing.isTeamSport = s.isTeamSport;
      await existing.save();
      report.push(`updated  ${s.name.padEnd(13)} (${s.scoringType}/${s.category})`);
    } else {
      await Sport.create({ ...s, slug });
      report.push(`created  ${s.name.padEnd(13)} (${s.scoringType}/${s.category})`);
    }
  }
  console.log("── CSL 4.0 sports seed ──");
  report.forEach((r) => console.log("  " + r));
  await mongoose.disconnect();
  process.exit(0);
}

if (require.main === module) {
  run().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { CSL_SPORTS };
