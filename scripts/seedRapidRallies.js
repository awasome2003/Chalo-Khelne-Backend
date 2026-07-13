#!/usr/bin/env node
/**
 * Seed Script: Populate a "Rapid Rallies S1" (Kharadi TT) team event with
 * 6 five-player teams for a league (round-robin) → top-4 → knockout demo.
 *
 * Each team = exactly 5 players in ordered slots P1..P5, with slot P3 female
 * (plays the female singles rubber). No substitutes — Rapid Rallies is exactly 5.
 *
 * Tournament patches applied at seed time (additive, idempotent):
 *   - Table Tennis sport track: knockoutFormat → "Davis Cup"
 *   - Table Tennis sport track: davisCupFormatId → "rapid_rallies_s1"
 *       (THE wiring hook — makes the round-robin generator use the 5-slot
 *        Rapid Rallies config path instead of the legacy A/B/C sequence)
 *   - tournament.lineupMode → "dynamic" (captain picks before each match)
 *   - sports[tt].categories += "Team Event"
 *
 * Idempotent: re-running deletes any users/bookings/teams previously created
 * by this script (matched by email suffix / tournamentId) before re-seeding.
 *
 * Requires an EXISTING tournament that has a Table Tennis sport track (create it
 * on the web manager first). Pass its id:
 *   RR_TOURNAMENT_ID=<id> node scripts/seedRapidRallies.js
 *   # or:  node scripts/seedRapidRallies.js <id>
 */

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("../src/modules/identity/models/User");
const Tournament = require("../src/modules/tournaments/models/Tournament");
const Booking = require("../src/modules/tournaments/models/BookingModel");
const TeamKnockoutTeams = require("../src/modules/tournaments/models/TeamKnockoutTeams");

const TOURNAMENT_ID = process.env.RR_TOURNAMENT_ID || process.argv[2] || "";
const EMAIL_SUFFIX = "@rapidrallies2026.test";
const TEAM_CATEGORY = "Team Event";
const RR_FORMAT_ID = "rapid_rallies_s1";
const MOBILE_BASE = 9700000000;

// 6 teams × 5 players. Slot P3 (index 2) is female on every team.
const TEAMS = [
  {
    teamName: "Kharadi Kings",
    players: [
      { name: "Rohan Mehta", sex: "male" },
      { name: "Vikram Rao", sex: "male" },
      { name: "Isha Nair", sex: "female" },
      { name: "Kabir Shah", sex: "male" },
      { name: "Arjun Das", sex: "male" },
    ],
  },
  {
    teamName: "Spin Warriors",
    players: [
      { name: "Aditya Kulkarni", sex: "male" },
      { name: "Nikhil Verma", sex: "male" },
      { name: "Priya Menon", sex: "female" },
      { name: "Sameer Joshi", sex: "male" },
      { name: "Rahul Iyer", sex: "male" },
    ],
  },
  {
    teamName: "Paddle Pros",
    players: [
      { name: "Karan Malhotra", sex: "male" },
      { name: "Dev Patel", sex: "male" },
      { name: "Anjali Reddy", sex: "female" },
      { name: "Yash Gupta", sex: "male" },
      { name: "Manav Bhatia", sex: "male" },
    ],
  },
  {
    teamName: "Table Titans",
    players: [
      { name: "Siddharth Jain", sex: "male" },
      { name: "Harsh Agarwal", sex: "male" },
      { name: "Neha Kapoor", sex: "female" },
      { name: "Varun Sinha", sex: "male" },
      { name: "Aryan Chopra", sex: "male" },
    ],
  },
  {
    teamName: "Rally Rebels",
    players: [
      { name: "Aman Khanna", sex: "male" },
      { name: "Rishi Saxena", sex: "male" },
      { name: "Diya Pillai", sex: "female" },
      { name: "Tarun Bose", sex: "male" },
      { name: "Kunal Mishra", sex: "male" },
    ],
  },
  {
    teamName: "Smash Squad",
    players: [
      { name: "Nitin Rana", sex: "male" },
      { name: "Gaurav Sethi", sex: "male" },
      { name: "Meera Krishnan", sex: "female" },
      { name: "Akash Nanda", sex: "male" },
      { name: "Ronit Bhatt", sex: "male" },
    ],
  },
];

const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");

function ensureCategory(tournament, trackIdx, name) {
  const cats = tournament.sports[trackIdx].categories;
  const existing = cats.find((c) => c.name === name);
  if (existing) return existing;
  cats.push({ templateId: null, name, fee: 0, minAge: null, maxAge: null, gender: "any" });
  return cats[cats.length - 1];
}

async function seed() {
  if (!TOURNAMENT_ID) {
    console.error("✗ No tournament id. Pass RR_TOURNAMENT_ID=<id> or `node scripts/seedRapidRallies.js <id>`.");
    console.error("  The tournament must already exist and have a Table Tennis sport track.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("✓ Connected to MongoDB\n");

  const tournament = await Tournament.findById(TOURNAMENT_ID);
  if (!tournament) {
    console.error(`✗ Tournament ${TOURNAMENT_ID} not found`);
    process.exit(1);
  }
  console.log(`✓ Tournament: ${tournament.title}`);

  const trackIdx = tournament.sports.findIndex((s) => s.sportName === "Table Tennis");
  if (trackIdx === -1) {
    console.error("✗ No Table Tennis sport track on tournament");
    process.exit(1);
  }
  const track = tournament.sports[trackIdx];

  // ── 1. Patch tournament: Davis Cup + rapid_rallies_s1 + dynamic lineup + category ──
  ensureCategory(tournament, trackIdx, TEAM_CATEGORY);
  const patches = [];
  if (track.knockoutFormat !== "Davis Cup") { track.knockoutFormat = "Davis Cup"; patches.push('knockoutFormat="Davis Cup"'); }
  if (track.davisCupFormatId !== RR_FORMAT_ID) { track.davisCupFormatId = RR_FORMAT_ID; patches.push(`davisCupFormatId="${RR_FORMAT_ID}"`); }
  if (tournament.lineupMode !== "dynamic") { tournament.lineupMode = "dynamic"; patches.push('lineupMode="dynamic"'); }
  tournament.markModified("sports");
  await tournament.save();
  console.log(`✓ Category: ensured "${TEAM_CATEGORY}"`);
  if (patches.length) console.log(`✓ Patched: ${patches.join(", ")}`);
  console.log("");

  // ── 2. Cleanup prior seed runs (idempotent) ──
  const oldUsers = await User.find({ email: { $regex: EMAIL_SUFFIX + "$" } }, "_id");
  if (oldUsers.length > 0) {
    const ids = oldUsers.map((u) => u._id);
    await Booking.deleteMany({ userId: { $in: ids } });
    await User.deleteMany({ _id: { $in: ids } });
    console.log(`✓ Cleaned up ${oldUsers.length} prior seed users + bookings`);
  }
  const oldTeams = await TeamKnockoutTeams.countDocuments({ tournamentId: tournament._id });
  if (oldTeams > 0) {
    await TeamKnockoutTeams.deleteMany({ tournamentId: tournament._id });
    console.log(`✓ Cleaned up ${oldTeams} prior teams`);
  }
  console.log("");

  const hashedPassword = await bcrypt.hash("sport123", 10);
  const teamCat = track.categories.find((c) => c.name === TEAM_CATEGORY) || { fee: 0 };

  // ── 3. Create 6 teams × 5 players (P3 female) ──
  console.log(`${"═".repeat(60)}`);
  console.log(`  RAPID RALLIES · ${TEAMS.length} teams × 5 players`);
  console.log(`${"═".repeat(60)}`);

  let mobileSeq = 0;
  for (const team of TEAMS) {
    // Create the 5 player users.
    const users = [];
    for (let i = 0; i < team.players.length; i++) {
      const { name, sex } = team.players[i];
      const user = await User.create({
        name,
        email: `${slugify(name)}${EMAIL_SUFFIX}`,
        mobile: String(MOBILE_BASE + ++mobileSeq),
        dateOfBirth: new Date(1990 + (mobileSeq % 15), mobileSeq % 12, (mobileSeq % 27) + 1),
        sex,
        age: 22 + (mobileSeq % 20),
        password: hashedPassword,
        role: "player",
        isApproved: true,
        playerId: `RR${String(mobileSeq).padStart(3, "0")}`,
      });
      users.push(user);
    }
    const captain = users[0]; // P1 is the captain

    // Team Event booking for the captain (gives the team an originalBookingId).
    const captainBooking = await Booking.create({
      userId: captain._id,
      userName: captain.name,
      userEmail: captain.email,
      userPhone: captain.mobile,
      tournamentId: tournament._id,
      tournamentName: tournament.title,
      tournamentType: track.type || "knockout + group stage",
      status: "confirmed",
      paymentStatus: "paid",
      paymentAmount: teamCat.fee ?? 0,
      paymentMethod: "cash",
      sportSelections: [{
        sportId: track.sportId,
        sportName: track.sportName,
        categoryName: TEAM_CATEGORY,
        fee: teamCat.fee ?? 0,
      }],
      totalFee: teamCat.fee ?? 0,
      team: {
        name: team.teamName,
        captain: { name: captain.name, id: String(captain._id), profileImage: "" },
      },
    });

    // Ordered roster P1..P5 with gender (the Rapid Rallies engine reads this).
    const roster = users.map((u, i) => ({
      userId: u._id,
      name: u.name,
      role: i === 0 ? "captain" : "player",
      position: `P${i + 1}`,
      gender: team.players[i].sex,
    }));

    await TeamKnockoutTeams.create({
      tournamentId: tournament._id,
      originalBookingId: captainBooking._id,
      teamName: team.teamName,
      // playerPositions A/B required by schema — mirror P1/P2/P3 so legacy code
      // paths don't choke; the authoritative 5-slot data lives in roster[].
      playerPositions: { A: users[0].name, B: users[1].name, C: users[2].name },
      roster,
      teamSize: 5,
      status: "ACTIVE",
    });

    const femaleP3 = roster[2];
    console.log(`  ✓ ${team.teamName.padEnd(16)} P1 ${captain.name.padEnd(18)} | P3(F) ${femaleP3.name}`);
  }
  console.log("");

  // ── Summary ──
  console.log(`${"═".repeat(60)}`);
  console.log("  SEED COMPLETE");
  console.log(`${"═".repeat(60)}`);
  console.log(`  Tournament:  ${tournament.title}  (${tournament._id})`);
  console.log(`  Format:      ${RR_FORMAT_ID} · lineupMode=dynamic`);
  console.log(`  Teams:       ${TEAMS.length} × 5 players (P3 female), no substitutes`);
  console.log(`  Round-robin: ${TEAMS.length * (TEAMS.length - 1) / 2} ties → top 4 → knockout`);
  console.log("");
  console.log(`  Login:       <name-slug>${EMAIL_SUFFIX}`);
  console.log(`  Password:    sport123`);
  console.log("");
  console.log("  Next (web manager): Team Event → Generate Round Robin → score ties");

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("✗ Seed failed:", err);
  process.exit(1);
});
