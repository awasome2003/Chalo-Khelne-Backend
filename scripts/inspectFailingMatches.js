#!/usr/bin/env node
require("dotenv").config();
const mongoose = require("mongoose");
const TournamentMatch = require("../Modal/Tournnamentmatch");
const DirectKnockoutMatch = require("../Modal/DirectKnockoutMatch");
const SuperMatch = require("../Modal/SuperMatch");
const KnockoutMatch = require("../Modal/KnockoutMatch");
const TeamKnockoutMatches = require("../Modal/TeamKnockoutMatches");
const Tournament = require("../Modal/Tournament");

const COLLECTIONS = [
  ["TournamentMatch", TournamentMatch],
  ["DirectKnockoutMatch", DirectKnockoutMatch],
  ["SuperMatch", SuperMatch],
  ["KnockoutMatch", KnockoutMatch],
  ["TeamKnockoutMatches", TeamKnockoutMatches],
];

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const ids = [
    "6a0ff652de39993fed1c4610",
    "6a0ff652de39993fed1c4611",
    "6a0ff652de39993fed1c4612",
  ];
  let foundModel = null;
  let foundDoc = null;
  for (const id of ids) {
    for (const [name, Model] of COLLECTIONS) {
      const m = await Model.findById(id).lean();
      if (m) {
        console.log(`✓ ${id} in ${name}`);
        console.log("  status:    ", m.status);
        console.log("  matchFmt:  ", JSON.stringify(m.matchFormat || null));
        console.log("  format:    ", m.format || "(none)");
        if (!foundModel) { foundModel = name; foundDoc = m; }
        break;
      }
    }
  }
  if (foundDoc) {
    const t = await Tournament.findById(foundDoc.tournamentId).lean();
    console.log("\n=== TOURNAMENT sports[0].matchFormat ===");
    console.log(JSON.stringify(t?.sports?.[0]?.matchFormat || null, null, 2));
    console.log("=== TOURNAMENT root matchFormat (legacy) ===");
    console.log(JSON.stringify(t?.matchFormat || null, null, 2));
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
