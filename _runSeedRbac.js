// One-off runner: seed RBAC roles + permissions into the DB.
// Run: node _runSeedRbac.js
require("dotenv").config();
const mongoose = require("mongoose");
const seedRbac = require("./scripts/seedRbac");

(async () => {
  if (!process.env.MONGO_URI) { console.error("MONGO_URI missing from .env"); process.exit(1); }
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected. Seeding RBAC...");
  const summary = await seedRbac();
  console.log("✅ Done:", JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
