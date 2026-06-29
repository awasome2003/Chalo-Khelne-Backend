/**
 * One-off: give the cricket teams in the MANAGER FLOW TEST tournament a squad
 * (player names by batting order) so the web scorer's setup screen shows the
 * roster to reorder. Run:  node _seedTestSquads.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Match = require("./src/modules/tournaments/models/Tournnamentmatch");

const TID = "6a3a17250f55b4daf886f967";

const ROSTERS = {
  "Royal Strikers": ["Rohit Sharma", "Virat Kohli", "Suryakumar Yadav", "Hardik Pandya", "Ravindra Jadeja", "Jasprit Bumrah"],
  "Thunder Kings": ["MS Dhoni", "Ruturaj Gaikwad", "Shivam Dube", "Moeen Ali", "Deepak Chahar", "Matheesha Pathirana"],
  "Phoenix XI": ["KL Rahul", "Shubman Gill", "Rishabh Pant", "Axar Patel", "Kuldeep Yadav", "Mohammed Shami"],
  "Titan Warriors": ["Shreyas Iyer", "Ishan Kishan", "Washington Sundar", "Arshdeep Singh", "Yuzvendra Chahal", "Mohammed Siraj"],
};

const mk = (names) => names.map((name, i) => ({ userId: null, name, battingOrder: i + 1 }));

(async () => {
  if (!process.env.MONGO_URI) { console.error("MONGO_URI missing"); process.exit(1); }
  await mongoose.connect(process.env.MONGO_URI);
  const matches = await Match.find({ tournamentId: TID, sportName: "Cricket" });
  let updated = 0;
  for (const m of matches) {
    const r1 = ROSTERS[m.player1?.userName];
    const r2 = ROSTERS[m.player2?.userName];
    if (r1) { m.player1.squad = mk(r1); m.markModified("player1"); }
    if (r2) { m.player2.squad = mk(r2); m.markModified("player2"); }
    if (r1 || r2) { await m.save(); updated++; }
  }
  console.log(`✅ Squads set on ${updated} cricket match(es).`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
