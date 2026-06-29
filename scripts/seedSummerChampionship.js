#!/usr/bin/env node
/**
 * Seed Script: Populate the "Summer Championship" tournament
 *   (_id: 69f340cfb16abf19e2875e52)
 * with players, confirmed bookings, and group-stage groups for both sports.
 *
 *   Badminton: 24 players → 6 groups of 4 (top 2 → 12 KO seeds)
 *   Table Tennis: 16 players → 4 groups of 4 (top 3 → 12 advance for Doubles KO)
 *
 * Idempotent: re-running deletes any users/bookings/groups previously created
 * by this script (matched by email suffix) before re-seeding.
 *
 * Usage:
 *   cd server && node scripts/seedSummerChampionship.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("../src/modules/identity/models/User");
const Tournament = require("../src/modules/tournaments/models/Tournament");
const Booking = require("../src/modules/tournaments/models/BookingModel");
const BookingGroup = require("../src/modules/tournaments/models/bookinggroup");

const TOURNAMENT_ID = "69f340cfb16abf19e2875e52";
const EMAIL_SUFFIX = "@summer2026.test";

const BADMINTON_PLAYERS = [
  "Aarav Mehta", "Ishaan Kapoor", "Reyansh Singh", "Vihaan Sharma",
  "Aditya Patel", "Krishna Iyer", "Arjun Reddy", "Vivaan Gupta",
  "Ayaan Khanna", "Atharv Joshi", "Kabir Malhotra", "Dhruv Rao",
  "Pranav Saxena", "Ansh Bansal", "Yash Verma", "Shaurya Bose",
  "Aryan Nair", "Rohan Bhatt", "Veer Chopra", "Arnav Shetty",
  "Diya Kulkarni", "Anaya Menon", "Saanvi Kohli", "Myra Pillai",
];

const TABLE_TENNIS_PLAYERS = [
  "Sharath Kumar", "Manika Rao", "Sathiyan Iyengar", "Sreeja Pillai",
  "Harmeet Mehta", "Manav Joshi", "Sutirtha Banerjee", "Archana Sundar",
  "Anirban Ghosh", "Devyani Sahu", "Naina Hegde", "Yashaswini Rao",
  "Madhurika Patel", "Ankita Das", "Reeth Tennison", "Payas Jain",
];

const slugify = (s) => String(s || "").toLowerCase().replace(/\s+/g, ".");

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✓ Connected to MongoDB\n");

  const tournament = await Tournament.findById(TOURNAMENT_ID);
  if (!tournament) {
    console.error(`✗ Tournament ${TOURNAMENT_ID} not found`);
    process.exit(1);
  }
  console.log(`✓ Tournament: ${tournament.title} (${tournament.sports.length} sports)\n`);

  // ── Cleanup any previous seed runs (idempotent) ──
  const oldEmails = await User.find({ email: { $regex: EMAIL_SUFFIX + "$" } }, "_id email");
  if (oldEmails.length > 0) {
    const ids = oldEmails.map((u) => u._id);
    await Booking.deleteMany({ userId: { $in: ids } });
    await User.deleteMany({ _id: { $in: ids } });
    console.log(`✓ Cleaned up ${oldEmails.length} previous seed users + bookings`);
  }
  const oldGroupCount = await BookingGroup.countDocuments({
    tournamentId: tournament._id,
    groupName: { $regex: /^Group [A-Z]$/ },
  });
  if (oldGroupCount > 0) {
    await BookingGroup.deleteMany({
      tournamentId: tournament._id,
      groupName: { $regex: /^Group [A-Z]$/ },
    });
    console.log(`✓ Cleaned up ${oldGroupCount} previous booking groups\n`);
  } else {
    console.log("");
  }

  const hashedPassword = await bcrypt.hash("sport123", 10);

  // ── Per-sport seeding ──
  const sportPlans = [
    {
      sportName: "Badminton",
      players: BADMINTON_PLAYERS,
      groupSize: 4, // 6 groups × 4 = 24
      prefix: "BD",
      mobileBase: 9700000000,
    },
    {
      sportName: "Table Tennis",
      players: TABLE_TENNIS_PLAYERS,
      groupSize: 4, // 4 groups × 4 = 16
      prefix: "TT",
      mobileBase: 9800000000,
    },
  ];

  const summary = [];

  for (const plan of sportPlans) {
    const track = tournament.sports.find((s) => s.sportName === plan.sportName);
    if (!track) {
      console.warn(`✗ Sport "${plan.sportName}" not found on tournament — skipping`);
      continue;
    }

    console.log(`${"═".repeat(60)}`);
    console.log(`  ${plan.sportName.toUpperCase()}`);
    console.log(`  ${plan.players.length} players → ${plan.players.length / plan.groupSize} groups of ${plan.groupSize}`);
    console.log(`${"═".repeat(60)}`);

    // ── Create players ──
    const createdUsers = [];
    for (let i = 0; i < plan.players.length; i++) {
      const fullName = plan.players[i];
      const emailLocal = slugify(fullName) + "." + plan.prefix.toLowerCase();
      const user = await User.create({
        name: fullName,
        email: `${emailLocal}${EMAIL_SUFFIX}`,
        mobile: String(plan.mobileBase + i + 1),
        dateOfBirth: new Date(1995 + (i % 10), i % 12, ((i % 27) + 1)),
        sex: i % 4 === 0 ? "female" : "male",
        age: 22 + ((i * 3) % 18),
        password: hashedPassword,
        role: "player",
        isApproved: true,
        playerId: `${plan.prefix}${String(i + 1).padStart(3, "0")}`,
      });
      createdUsers.push(user);
    }
    console.log(`  ✓ Players: ${createdUsers.length}`);

    // ── Create bookings ──
    for (const user of createdUsers) {
      await Booking.create({
        userId: user._id,
        userName: user.name,
        userEmail: user.email,
        userPhone: user.mobile,
        tournamentId: tournament._id,
        tournamentName: tournament.title,
        tournamentType: track.type || "knockout + group stage",
        status: "confirmed",
        paymentStatus: "paid",
        paymentAmount: 0,
        paymentMethod: "cash",
        sportSelections: [{
          sportId: track.sportId,
          sportName: track.sportName,
          categoryName: track.categories[0]?.name || "Open Category",
          fee: track.categories[0]?.fee ?? 0,
        }],
        totalFee: 0,
      });
    }
    console.log(`  ✓ Bookings: ${createdUsers.length}`);

    // ── Create booking groups ──
    const groupCount = createdUsers.length / plan.groupSize;
    const createdGroups = [];
    for (let g = 0; g < groupCount; g++) {
      const groupName = `Group ${String.fromCharCode(65 + g)}`; // A, B, C, ...
      const slice = createdUsers.slice(g * plan.groupSize, (g + 1) * plan.groupSize);
      const groupPlayers = slice.map((u) => ({
        playerId: u._id,
        userName: u.name,
        bookingDate: new Date(),
        joinedAt: new Date(),
      }));
      const bg = await BookingGroup.create({
        tournamentId: tournament._id,
        sportId: track.sportId,
        groupName,
        category: track.categories[0]?.name || "Open Category",
        players: groupPlayers,
        matchFormat: track.matchFormat,
      });
      createdGroups.push(bg);
      const names = slice.map((u) => u.name.split(" ")[0]).join(", ");
      console.log(`  ✓ ${groupName}: ${names}`);
    }

    summary.push({
      sport: plan.sportName,
      players: createdUsers.length,
      groups: createdGroups.length,
    });
    console.log("");
  }

  // ── Summary ──
  console.log(`${"═".repeat(60)}`);
  console.log("  SEED COMPLETE");
  console.log(`${"═".repeat(60)}`);
  for (const s of summary) {
    console.log(`  ${s.sport.padEnd(15)} ${String(s.players).padStart(3)} players  ${String(s.groups).padStart(2)} groups`);
  }
  console.log("");
  console.log(`  Tournament: ${tournament.title}`);
  console.log(`  ID:         ${tournament._id}`);
  console.log("");
  console.log(`  Login:      <any test email>${EMAIL_SUFFIX}`);
  console.log(`  Password:   sport123`);
  console.log("");
  console.log("  Next: open Tournament Management → Groups → Generate Matches");

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("✗ Seed failed:", err);
  process.exit(1);
});
