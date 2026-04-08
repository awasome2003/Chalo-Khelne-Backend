#!/usr/bin/env node
/**
 * Seed Script: Create tournaments for ALL sports with players/teams.
 *
 * Creates 10 tournaments (one per sport), each with:
 * - 8 players (individual) or 4 teams (team sports)
 * - Confirmed bookings
 * - 2 groups of 4 players each
 * - Sport-aware matchFormat with correct scoringType
 *
 * Usage:
 *   cd server && node scripts/seedAllSportsTournaments.js
 *
 * Prerequisites:
 *   - MongoDB running
 *   - At least 1 manager account exists (set MANAGER_ID below or auto-detect)
 */

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("../Modal/User");
const { Manager } = require("../Modal/ClubManager");
const Tournament = require("../Modal/Tournament");
const Booking = require("../Modal/BookingModel");
const BookingGroup = require("../Modal/bookinggroup");

// ════════════════════════════════════════════════════════════
// TOURNAMENT DEFINITIONS — ONE PER SPORT TYPE
// ════════════════════════════════════════════════════════════

const TOURNAMENTS = [
  // ── SETS-BASED ──
  {
    sport: "Table Tennis",
    title: "National TT Championship 2026",
    scoringType: "sets",
    matchFormat: {
      scoringType: "sets",
      totalSets: 5, setsToWin: 3,
      totalGames: 5, gamesToWin: 3,
      pointsToWinGame: 11, marginToWin: 2, deuceRule: true,
    },
    players: [
      { name: "Sharath Kamal", email: "sharath@tt.test", mobile: "9200000001" },
      { name: "Manika Batra", email: "manika@tt.test", mobile: "9200000002" },
      { name: "Sathiyan G", email: "sathiyan@tt.test", mobile: "9200000003" },
      { name: "Sreeja Akula", email: "sreeja@tt.test", mobile: "9200000004" },
      { name: "Harmeet Desai", email: "harmeet@tt.test", mobile: "9200000005" },
      { name: "Manav Thakkar", email: "manav@tt.test", mobile: "9200000006" },
      { name: "Sutirtha Mukherjee", email: "sutirtha@tt.test", mobile: "9200000007" },
      { name: "Archana Kamath", email: "archana@tt.test", mobile: "9200000008" },
    ],
  },
  {
    sport: "Badminton",
    title: "Badminton Premier League 2026",
    scoringType: "sets",
    matchFormat: {
      scoringType: "sets",
      totalSets: 3, setsToWin: 2,
      totalGames: 1, gamesToWin: 1,
      pointsToWinGame: 21, marginToWin: 2, deuceRule: true,
    },
    players: [
      { name: "PV Sindhu", email: "sindhu@bm.test", mobile: "9200000011" },
      { name: "Lakshya Sen", email: "lakshya@bm.test", mobile: "9200000012" },
      { name: "Saina Nehwal", email: "saina@bm.test", mobile: "9200000013" },
      { name: "Kidambi Srikanth", email: "srikanth@bm.test", mobile: "9200000014" },
      { name: "HS Prannoy", email: "prannoy@bm.test", mobile: "9200000015" },
      { name: "Sai Praneeth", email: "praneeth@bm.test", mobile: "9200000016" },
      { name: "Ashwini Ponnappa", email: "ashwini@bm.test", mobile: "9200000017" },
      { name: "Satwiksairaj R", email: "satwik@bm.test", mobile: "9200000018" },
    ],
  },
  {
    sport: "Tennis",
    title: "Tennis Open Championship 2026",
    scoringType: "sets",
    matchFormat: {
      scoringType: "sets",
      totalSets: 3, setsToWin: 2,
      totalGames: 13, gamesToWin: 7,
      pointsToWinGame: 4, marginToWin: 2, deuceRule: true,
      tiebreakEnabled: true,
    },
    players: [
      { name: "Sumit Nagal", email: "sumit@tn.test", mobile: "9200000021" },
      { name: "Rohan Bopanna", email: "rohan@tn.test", mobile: "9200000022" },
      { name: "Yuki Bhambri", email: "yuki@tn.test", mobile: "9200000023" },
      { name: "Ramkumar Ramanathan", email: "ramkumar@tn.test", mobile: "9200000024" },
      { name: "Sania Mirza", email: "sania@tn.test", mobile: "9200000025" },
      { name: "Ankita Raina", email: "ankita@tn.test", mobile: "9200000026" },
      { name: "Prajnesh Gunneswaran", email: "prajnesh@tn.test", mobile: "9200000027" },
      { name: "Sasikumar Mukund", email: "sasikumar@tn.test", mobile: "9200000028" },
    ],
  },
  {
    sport: "Volleyball",
    title: "Volleyball Super Series 2026",
    scoringType: "sets",
    matchFormat: {
      scoringType: "sets",
      totalSets: 5, setsToWin: 3,
      totalGames: 1, gamesToWin: 1,
      pointsToWinGame: 25, marginToWin: 2, deuceRule: true,
      decidingSetPoints: 15,
    },
    players: [
      { name: "Amit Kumar", email: "amit@vb.test", mobile: "9200000031" },
      { name: "Gurinder Singh", email: "gurinder@vb.test", mobile: "9200000032" },
      { name: "Ranjit Singh", email: "ranjit@vb.test", mobile: "9200000033" },
      { name: "Mohan Kumar", email: "mohan@vb.test", mobile: "9200000034" },
      { name: "Karthik V", email: "karthik@vb.test", mobile: "9200000035" },
      { name: "Jerome Vinith", email: "jerome@vb.test", mobile: "9200000036" },
      { name: "Ashwal Rai", email: "ashwal@vb.test", mobile: "9200000037" },
      { name: "Deepesh Sinha", email: "deepesh@vb.test", mobile: "9200000038" },
    ],
  },

  // ── TIME-BASED ──
  {
    sport: "Football",
    title: "Football Champions League 2026",
    scoringType: "time",
    matchFormat: {
      scoringType: "time",
      totalSets: 1, setsToWin: 1,
      totalGames: 1, gamesToWin: 1,
      pointsToWinGame: 1, marginToWin: 1, deuceRule: false,
      halvesCount: 2, halvesDuration: 45,
    },
    players: [
      { name: "Sunil Chhetri", email: "sunil@fb.test", mobile: "9200000041" },
      { name: "Sandesh Jhingan", email: "sandesh@fb.test", mobile: "9200000042" },
      { name: "Gurpreet Singh", email: "gurpreet@fb.test", mobile: "9200000043" },
      { name: "Anirudh Thapa", email: "anirudh@fb.test", mobile: "9200000044" },
      { name: "Brandon Fernandes", email: "brandon@fb.test", mobile: "9200000045" },
      { name: "Udanta Singh", email: "udanta@fb.test", mobile: "9200000046" },
      { name: "Sahal Abdul Samad", email: "sahal@fb.test", mobile: "9200000047" },
      { name: "Manvir Singh", email: "manvir@fb.test", mobile: "9200000048" },
    ],
  },
  {
    sport: "Basketball",
    title: "Basketball Pro Tournament 2026",
    scoringType: "time",
    matchFormat: {
      scoringType: "time",
      totalSets: 1, setsToWin: 1,
      totalGames: 1, gamesToWin: 1,
      pointsToWinGame: 1, marginToWin: 1, deuceRule: false,
      quartersCount: 4, quartersDuration: 12,
    },
    players: [
      { name: "Amjyot Singh", email: "amjyot@bb.test", mobile: "9200000051" },
      { name: "Satnam Singh", email: "satnam@bb.test", mobile: "9200000052" },
      { name: "Vishesh Bhriguvanshi", email: "vishesh@bb.test", mobile: "9200000053" },
      { name: "Amritpal Singh", email: "amritpal@bb.test", mobile: "9200000054" },
      { name: "Princepal Singh", email: "princepal@bb.test", mobile: "9200000055" },
      { name: "Arvind Annam", email: "arvind@bb.test", mobile: "9200000056" },
      { name: "Yadwinder Singh", email: "yadwinder@bb.test", mobile: "9200000057" },
      { name: "Aravind Arumugam", email: "aravind@bb.test", mobile: "9200000058" },
    ],
  },

  // ── INNINGS-BASED ──
  {
    sport: "Cricket",
    title: "Cricket T20 Cup 2026",
    scoringType: "innings",
    matchFormat: {
      scoringType: "innings",
      totalSets: 1, setsToWin: 1,
      totalGames: 1, gamesToWin: 1,
      pointsToWinGame: 1, marginToWin: 1, deuceRule: false,
      oversCount: 20, inningsCount: 2,
    },
    players: [
      { name: "Virat Kohli", email: "virat@cr.test", mobile: "9200000061" },
      { name: "Rohit Sharma", email: "rohit@cr.test", mobile: "9200000062" },
      { name: "Jasprit Bumrah", email: "jasprit@cr.test", mobile: "9200000063" },
      { name: "Rishabh Pant", email: "rishabh@cr.test", mobile: "9200000064" },
      { name: "Shubman Gill", email: "shubman@cr.test", mobile: "9200000065" },
      { name: "Hardik Pandya", email: "hardik@cr.test", mobile: "9200000066" },
      { name: "Ravindra Jadeja", email: "jadeja@cr.test", mobile: "9200000067" },
      { name: "KL Rahul", email: "klrahul@cr.test", mobile: "9200000068" },
    ],
  },

  // ── SINGLE-RESULT ──
  {
    sport: "Chess",
    title: "Grand Chess Masters 2026",
    scoringType: "single",
    matchFormat: {
      scoringType: "single",
      totalSets: 1, setsToWin: 1,
      totalGames: 1, gamesToWin: 1,
      pointsToWinGame: 1, marginToWin: 0, deuceRule: false,
    },
    players: [
      { name: "Viswanathan Anand", email: "anand@ch.test", mobile: "9200000071" },
      { name: "Magnus Carlsen", email: "magnus@ch.test", mobile: "9200000072" },
      { name: "Hikaru Nakamura", email: "hikaru@ch.test", mobile: "9200000073" },
      { name: "Praggnanandhaa R", email: "pragg@ch.test", mobile: "9200000074" },
      { name: "Gukesh D", email: "gukesh@ch.test", mobile: "9200000075" },
      { name: "Arjun Erigaisi", email: "arjun@ch.test", mobile: "9200000076" },
      { name: "Koneru Humpy", email: "humpy@ch.test", mobile: "9200000077" },
      { name: "Harika Dronavalli", email: "harika@ch.test", mobile: "9200000078" },
    ],
  },
  {
    sport: "Carrom",
    title: "Carrom National Open 2026",
    scoringType: "single",
    matchFormat: {
      scoringType: "single",
      totalSets: 1, setsToWin: 1,
      totalGames: 1, gamesToWin: 1,
      pointsToWinGame: 1, marginToWin: 0, deuceRule: false,
    },
    players: [
      { name: "Maria Irudayam", email: "maria@cm.test", mobile: "9200000081" },
      { name: "Prashant More", email: "prashant@cm.test", mobile: "9200000082" },
      { name: "Rashmi Kumari", email: "rashmi@cm.test", mobile: "9200000083" },
      { name: "Yogesh Pardeshi", email: "yogesh@cm.test", mobile: "9200000084" },
      { name: "Nishant Anand", email: "nishant@cm.test", mobile: "9200000085" },
      { name: "Sandeep Deshpande", email: "sandeep@cm.test", mobile: "9200000086" },
      { name: "Apoorva Deshpande", email: "apoorva@cm.test", mobile: "9200000087" },
      { name: "K. Srinivasa Rao", email: "srinivasa@cm.test", mobile: "9200000088" },
    ],
  },
  {
    sport: "Kabaddi",
    title: "Pro Kabaddi Season 2026",
    scoringType: "time",
    matchFormat: {
      scoringType: "time",
      totalSets: 1, setsToWin: 1,
      totalGames: 1, gamesToWin: 1,
      pointsToWinGame: 1, marginToWin: 1, deuceRule: false,
      halvesCount: 2, halvesDuration: 20,
    },
    players: [
      { name: "Pardeep Narwal", email: "pardeep@kb.test", mobile: "9200000091" },
      { name: "Pawan Sehrawat", email: "pawan@kb.test", mobile: "9200000092" },
      { name: "Naveen Kumar", email: "naveen@kb.test", mobile: "9200000093" },
      { name: "Rahul Chaudhari", email: "rahul@kb.test", mobile: "9200000094" },
      { name: "Fazel Atrachali", email: "fazel@kb.test", mobile: "9200000095" },
      { name: "Deepak Hooda", email: "deepak@kb.test", mobile: "9200000096" },
      { name: "Monu Goyat", email: "monu@kb.test", mobile: "9200000097" },
      { name: "Ajay Thakur", email: "ajay@kb.test", mobile: "9200000098" },
    ],
  },
];

// ════════════════════════════════════════════════════════════
// MAIN SEED FUNCTION
// ════════════════════════════════════════════════════════════

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB\n");

    // Find or create a manager
    let manager = await Manager.findOne({});
    if (!manager) {
      const hashedPw = await bcrypt.hash("manager123", 10);
      manager = await Manager.create({
        name: "Test Manager",
        email: "manager@test.com",
        mobile: "9200099999",
        password: hashedPw,
        role: "manager",
      });
      console.log(`Created test manager: ${manager._id}`);
    }
    console.log(`Using manager: ${manager.name} (${manager._id})\n`);

    const hashedPassword = await bcrypt.hash("sport123", 10);
    const summary = [];

    for (const tourney of TOURNAMENTS) {
      console.log(`\n${"═".repeat(60)}`);
      console.log(`  ${tourney.sport.toUpperCase()} — ${tourney.title}`);
      console.log(`  scoringType: ${tourney.scoringType}`);
      console.log(`${"═".repeat(60)}`);

      // ── Cleanup previous seed data ──
      const emails = tourney.players.map(p => p.email);
      const existingUsers = await User.find({ email: { $in: emails } });
      if (existingUsers.length > 0) {
        const ids = existingUsers.map(u => u._id);
        // Find and delete related tournaments
        const oldTournaments = await Tournament.find({ title: tourney.title, sportsType: tourney.sport });
        for (const ot of oldTournaments) {
          await Booking.deleteMany({ tournamentId: ot._id });
          await BookingGroup.deleteMany({ tournamentId: ot._id });
        }
        await Tournament.deleteMany({ title: tourney.title, sportsType: tourney.sport });
        await User.deleteMany({ email: { $in: emails } });
        console.log(`  Cleaned up ${existingUsers.length} existing seed players`);
      }

      // ── Create Tournament ──
      const tournament = await Tournament.create({
        title: tourney.title,
        type: "group stage",
        sportsType: tourney.sport,
        groupStageFormat: "Singles",
        currentStage: "group_stage",
        tournamentLevel: "district",
        organizerName: manager.name,
        managerId: [manager._id],
        startDate: "2026-04-15",
        endDate: "2026-04-20",
        eventLocation: ["Sports Complex, New Delhi"],
        category: [{ name: "Open Category", fee: 0 }],
        matchFormat: tourney.matchFormat,
        qualifyPerGroup: 2,
      });
      console.log(`  Tournament created: ${tournament._id}`);

      // ── Create Players ──
      const createdUsers = [];
      const sportSlug = tourney.sport.replace(/\s+/g, "").substring(0, 4).toUpperCase();

      for (let i = 0; i < tourney.players.length; i++) {
        const p = tourney.players[i];
        const user = await User.create({
          name: p.name,
          email: p.email,
          mobile: p.mobile,
          sex: i % 3 === 0 ? "female" : "male",
          age: 20 + Math.floor(Math.random() * 15),
          password: hashedPassword,
          role: "player",
          isApproved: true,
          playerId: `${sportSlug}${String(i + 1).padStart(3, "0")}`,
        });
        createdUsers.push(user);
      }
      console.log(`  Players created: ${createdUsers.length}`);

      // ── Create Bookings ──
      for (const user of createdUsers) {
        await Booking.create({
          userId: user._id,
          userName: user.name,
          userEmail: user.email,
          userPhone: user.mobile,
          tournamentId: tournament._id,
          tournamentName: tourney.title,
          tournamentType: "group stage",
          status: "confirmed",
          paymentStatus: "paid",
          paymentAmount: 0,
          paymentMethod: "cash",
          selectedCategories: [{ id: "open", name: "Open Category", price: 0 }],
        });
      }
      console.log(`  Bookings created: ${createdUsers.length}`);

      // ── Create 2 Groups of 4 ──
      const groupDefs = [
        { name: "Group A", indices: [0, 1, 2, 3] },
        { name: "Group B", indices: [4, 5, 6, 7] },
      ];

      const createdGroups = [];
      for (const gd of groupDefs) {
        const groupPlayers = gd.indices.map(idx => ({
          playerId: createdUsers[idx]._id,
          userName: createdUsers[idx].name,
          bookingDate: new Date(),
          joinedAt: new Date(),
        }));

        const bookingGroup = await BookingGroup.create({
          tournamentId: tournament._id,
          groupName: gd.name,
          category: "Open Category",
          players: groupPlayers,
          matchFormat: tourney.matchFormat,
        });
        createdGroups.push(bookingGroup);

        const names = gd.indices.map(i => tourney.players[i].name.split(" ")[0]).join(", ");
        console.log(`  ${gd.name}: ${names}`);
      }

      summary.push({
        sport: tourney.sport,
        scoringType: tourney.scoringType,
        tournamentId: tournament._id.toString(),
        title: tourney.title,
        players: createdUsers.length,
        groups: createdGroups.length,
        groupIds: createdGroups.map(g => g._id.toString()),
      });
    }

    // ── Print Summary ──
    console.log(`\n\n${"═".repeat(60)}`);
    console.log("  SEED COMPLETE — ALL TOURNAMENTS CREATED");
    console.log(`${"═".repeat(60)}\n`);

    console.log("┌─────────────────────┬──────────┬──────────────────────────┬────────┬────────┐");
    console.log("│ Sport               │ Type     │ Tournament ID            │ Players│ Groups │");
    console.log("├─────────────────────┼──────────┼──────────────────────────┼────────┼────────┤");
    for (const s of summary) {
      const sp = s.sport.padEnd(19);
      const tp = s.scoringType.padEnd(8);
      const id = s.tournamentId.substring(0, 24);
      console.log(`│ ${sp} │ ${tp} │ ${id} │ ${String(s.players).padStart(6)} │ ${String(s.groups).padStart(6)} │`);
    }
    console.log("└─────────────────────┴──────────┴──────────────────────────┴────────┴────────┘");

    console.log("\n\nNEXT STEPS:");
    console.log("  1. Open web app → Tournament Management");
    console.log("  2. Click on any tournament → Go to Groups");
    console.log("  3. Click 'Generate Matches' for each group");
    console.log("  4. Score matches using the scoring page");
    console.log("  5. Verify: scoringType, labels, matchResult all correct");
    console.log("");
    console.log("TEST CHECKLIST:");
    console.log("  [ ] Table Tennis → 'Set' labels, deuce handling, 11-point games");
    console.log("  [ ] Badminton   → 'Set' labels, 21-point games");
    console.log("  [ ] Tennis      → 'Set' labels, tiebreak");
    console.log("  [ ] Volleyball  → 'Set' labels, 25-point sets, 15-point deciding");
    console.log("  [ ] Football    → 'Period' labels, goals scoring, draws allowed");
    console.log("  [ ] Basketball  → 'Period' labels, high scores (80+)");
    console.log("  [ ] Cricket     → 'Innings' labels, runs + wickets");
    console.log("  [ ] Chess       → 'Result' label, 1-0 / 0-1 / draw");
    console.log("  [ ] Carrom      → 'Result' label, single result");
    console.log("  [ ] Kabaddi     → 'Period' labels, raid points");

    process.exit(0);
  } catch (error) {
    console.error("\nSeed failed:", error);
    process.exit(1);
  }
}

seed();
