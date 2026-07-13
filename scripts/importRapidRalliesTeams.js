#!/usr/bin/env node
/**
 * One-off: patch an existing tournament's Table Tennis track to Rapid Rallies
 * and import 8 teams × 5 players (P3 female) — same data as
 * Old_Version/RapidRallies_8Teams.xlsx.
 *
 *   RR_TOURNAMENT_ID=<id> node scripts/importRapidRalliesTeams.js
 *   # or: node scripts/importRapidRalliesTeams.js <id>
 *
 * Idempotent: deletes any TeamKnockoutTeams already on the tournament first.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Tournament = require("../src/modules/tournaments/models/Tournament");
const TeamKnockoutTeams = require("../src/modules/tournaments/models/TeamKnockoutTeams");

const TOURNAMENT_ID = process.env.RR_TOURNAMENT_ID || process.argv[2] || "";
const RR_FORMAT_ID = "rapid_rallies_s1";

const TEAMS = [
  { team: "Kharadi Kings",  players: [["Rohan Mehta","male"],["Vikram Rao","male"],["Isha Nair","female"],["Kabir Shah","male"],["Arjun Das","male"]] },
  { team: "Spin Warriors",  players: [["Aditya Kulkarni","male"],["Nikhil Verma","male"],["Priya Menon","female"],["Sameer Joshi","male"],["Rahul Iyer","male"]] },
  { team: "Paddle Pros",    players: [["Karan Malhotra","male"],["Dev Patel","male"],["Anjali Reddy","female"],["Yash Gupta","male"],["Manav Bhatia","male"]] },
  { team: "Table Titans",   players: [["Siddharth Jain","male"],["Harsh Agarwal","male"],["Neha Kapoor","female"],["Varun Sinha","male"],["Aryan Chopra","male"]] },
  { team: "Rally Rebels",   players: [["Aman Khanna","male"],["Rishi Saxena","male"],["Diya Pillai","female"],["Tarun Bose","male"],["Kunal Mishra","male"]] },
  { team: "Smash Squad",    players: [["Nitin Rana","male"],["Gaurav Sethi","male"],["Meera Krishnan","female"],["Akash Nanda","male"],["Ronit Bhatt","male"]] },
  { team: "Topspin Tigers", players: [["Vivek Anand","male"],["Rohit Sen","male"],["Sneha Rao","female"],["Aniket Pawar","male"],["Farhan Sheikh","male"]] },
  { team: "Net Ninjas",     players: [["Ishaan Roy","male"],["Deepak Nair","male"],["Kavya Suri","female"],["Om Prakash","male"],["Zaid Ansari","male"]] },
];

async function run() {
  if (!TOURNAMENT_ID) {
    console.error("✗ Pass RR_TOURNAMENT_ID=<id> or node scripts/importRapidRalliesTeams.js <id>");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✓ Connected to MongoDB");

  const tournament = await Tournament.findById(TOURNAMENT_ID);
  if (!tournament) { console.error(`✗ Tournament ${TOURNAMENT_ID} not found`); process.exit(1); }
  console.log(`✓ Tournament: ${tournament.title}`);

  const trackIdx = tournament.sports.findIndex((s) => s.sportName === "Table Tennis");
  if (trackIdx === -1) { console.error("✗ No Table Tennis sport track"); process.exit(1); }
  const track = tournament.sports[trackIdx];

  // ── Patch to Rapid Rallies (identical to picking the Davis Cup card) ──
  const patches = [];
  if (track.type !== "knockout") { track.type = "knockout"; patches.push('type="knockout"'); }
  if (track.knockoutFormat !== "Davis Cup") { track.knockoutFormat = "Davis Cup"; patches.push('knockoutFormat="Davis Cup"'); }
  if (track.davisCupFormatId !== RR_FORMAT_ID) { track.davisCupFormatId = RR_FORMAT_ID; patches.push(`davisCupFormatId="${RR_FORMAT_ID}"`); }
  if (tournament.lineupMode !== "dynamic") { tournament.lineupMode = "dynamic"; patches.push('lineupMode="dynamic"'); }
  tournament.markModified("sports");
  await tournament.save();
  console.log(patches.length ? `✓ Patched: ${patches.join(", ")}` : "✓ Already Rapid Rallies");

  // ── Reset + create teams (clubId set so tenant-scoped reads find them) ──
  const removed = await TeamKnockoutTeams.deleteMany({ tournamentId: tournament._id });
  if (removed.deletedCount) console.log(`✓ Removed ${removed.deletedCount} existing teams`);

  const clubId = tournament.clubId || undefined;
  for (const t of TEAMS) {
    const roster = t.players.map(([name, gender], i) => ({
      name, gender, position: `P${i + 1}`, role: i === 0 ? "captain" : "player",
    }));
    await TeamKnockoutTeams.create({
      tournamentId: tournament._id,
      clubId,
      originalBookingId: new mongoose.Types.ObjectId(),
      teamName: t.team,
      playerPositions: { A: roster[0].name, B: roster[1].name, C: roster[2].name },
      roster,
      teamSize: 5,
      status: "ACTIVE",
    });
    console.log(`  ✓ ${t.team.padEnd(16)} P3(F) ${roster[2].name}`);
  }

  console.log(`\n✓ Imported ${TEAMS.length} teams × 5 players into "${tournament.title}"`);
  console.log(`  Format: ${RR_FORMAT_ID} · lineupMode=dynamic`);
  console.log(`  Next (web manager): open the tournament → Registered Teams → Generate Round Robin`);
  await mongoose.disconnect();
}

run().catch((err) => { console.error("✗ Import failed:", err); process.exit(1); });
