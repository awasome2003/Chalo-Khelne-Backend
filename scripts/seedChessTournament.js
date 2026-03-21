/**
 * Seed script for Chess Tournament (knockout + group stage)
 * Tournament ID: 69b80633629e3ecc6f36a22d
 *
 * Creates: 16 players, 16 bookings, 4 groups of 4 players each
 *
 * Usage: cd server && node scripts/seedChessTournament.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("../Modal/User");
const Booking = require("../Modal/BookingModel");
const BookingGroup = require("../Modal/bookinggroup");

const TOURNAMENT_ID = "69b80633629e3ecc6f36a22d";
const TOURNAMENT_NAME = "chess tournament";
const TOURNAMENT_TYPE = "knockout";
const CATEGORY_ID = "69b80633629e3ecc6f36a22e";
const CATEGORY_NAME = "Open Category";

// 16 chess players
const players = [
  { name: "Viswanathan Anand", email: "anand@chess.com", mobile: "9100000001", sex: "male", age: 55 },
  { name: "Magnus Carlsen", email: "magnus@chess.com", mobile: "9100000002", sex: "male", age: 35 },
  { name: "Hikaru Nakamura", email: "hikaru@chess.com", mobile: "9100000003", sex: "male", age: 37 },
  { name: "Fabiano Caruana", email: "fabiano@chess.com", mobile: "9100000004", sex: "male", age: 32 },
  { name: "Ding Liren", email: "dingliren@chess.com", mobile: "9100000005", sex: "male", age: 33 },
  { name: "Ian Nepomniachtchi", email: "nepo@chess.com", mobile: "9100000006", sex: "male", age: 35 },
  { name: "Alireza Firouzja", email: "alireza@chess.com", mobile: "9100000007", sex: "male", age: 22 },
  { name: "Praggnanandhaa R", email: "pragg@chess.com", mobile: "9100000008", sex: "male", age: 19 },
  { name: "Gukesh D", email: "gukesh@chess.com", mobile: "9100000009", sex: "male", age: 19 },
  { name: "Arjun Erigaisi", email: "arjun@chess.com", mobile: "9100000010", sex: "male", age: 21 },
  { name: "Wesley So", email: "wesley@chess.com", mobile: "9100000011", sex: "male", age: 31 },
  { name: "Levon Aronian", email: "levon@chess.com", mobile: "9100000012", sex: "male", age: 42 },
  { name: "Anish Giri", email: "giri@chess.com", mobile: "9100000013", sex: "male", age: 31 },
  { name: "Maxime Vachier-Lagrave", email: "mvl@chess.com", mobile: "9100000014", sex: "male", age: 34 },
  { name: "Koneru Humpy", email: "humpy@chess.com", mobile: "9100000015", sex: "female", age: 37 },
  { name: "Harika Dronavalli", email: "harika@chess.com", mobile: "9100000016", sex: "female", age: 35 },
];

// 4 groups of 4 players each
const groups = [
  { name: "Group A", playerIndices: [0, 1, 2, 3] },
  { name: "Group B", playerIndices: [4, 5, 6, 7] },
  { name: "Group C", playerIndices: [8, 9, 10, 11] },
  { name: "Group D", playerIndices: [12, 13, 14, 15] },
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    // Check tournament exists
    const Tournament = require("../Modal/Tournament");
    const tournament = await Tournament.findById(TOURNAMENT_ID);
    if (!tournament) {
      console.error("Tournament not found! Check the ID.");
      process.exit(1);
    }
    console.log(`Found tournament: ${tournament.title}`);

    // Hash a common password for all seed players
    const hashedPassword = await bcrypt.hash("chess123", 10);

    // Clean up any previous seed data for these emails
    const emails = players.map(p => p.email);
    const existingUsers = await User.find({ email: { $in: emails } });
    if (existingUsers.length > 0) {
      const existingIds = existingUsers.map(u => u._id);
      await Booking.deleteMany({ userId: { $in: existingIds }, tournamentId: TOURNAMENT_ID });
      await BookingGroup.deleteMany({ tournamentId: TOURNAMENT_ID });
      await User.deleteMany({ email: { $in: emails } });
      console.log(`Cleaned up ${existingUsers.length} existing seed players and their data`);
    }

    // Create players
    const createdUsers = [];
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const user = await User.create({
        name: p.name,
        email: p.email,
        mobile: p.mobile,
        sex: p.sex,
        age: p.age,
        password: hashedPassword,
        role: "player",
        isApproved: true,
        playerId: `CHESS${String(i + 1).padStart(3, "0")}`,
      });
      createdUsers.push(user);
      console.log(`Created player: ${user.name} (${user._id})`);
    }

    // Create bookings for each player
    const createdBookings = [];
    for (const user of createdUsers) {
      const booking = await Booking.create({
        userId: user._id,
        userName: user.name,
        userEmail: user.email,
        userPhone: user.mobile,
        tournamentId: TOURNAMENT_ID,
        tournamentName: TOURNAMENT_NAME,
        tournamentType: TOURNAMENT_TYPE,
        status: "confirmed",
        paymentStatus: "paid",
        paymentAmount: 0,
        paymentMethod: "cash",
        selectedCategories: [
          {
            id: CATEGORY_ID,
            name: CATEGORY_NAME,
            price: 0,
          },
        ],
      });
      createdBookings.push(booking);
      console.log(`Created booking for: ${user.name}`);
    }

    // Create 4 groups with 4 players each
    for (const group of groups) {
      const groupPlayers = group.playerIndices.map(idx => ({
        playerId: createdUsers[idx]._id,
        userName: createdUsers[idx].name,
        bookingDate: new Date(),
        joinedAt: new Date(),
      }));

      const bookingGroup = await BookingGroup.create({
        tournamentId: TOURNAMENT_ID,
        groupName: group.name,
        category: CATEGORY_NAME,
        players: groupPlayers,
        matchFormat: {
          totalSets: 1,
          setsToWin: 1,
          totalGames: 1,
          gamesToWin: 1,
          pointsToWinGame: 1,
          marginToWin: 0,
          deuceRule: false,
        },
      });

      const playerNames = group.playerIndices.map(idx => createdUsers[idx].name).join(", ");
      console.log(`Created ${group.name}: ${playerNames}`);
    }

    console.log("\n--- Seed Complete ---");
    console.log(`Players created: ${createdUsers.length}`);
    console.log(`Bookings created: ${createdBookings.length}`);
    console.log(`Groups created: ${groups.length}`);
    console.log(`\nGroup A: ${groups[0].playerIndices.map(i => players[i].name).join(", ")}`);
    console.log(`Group B: ${groups[1].playerIndices.map(i => players[i].name).join(", ")}`);
    console.log(`Group C: ${groups[2].playerIndices.map(i => players[i].name).join(", ")}`);
    console.log(`Group D: ${groups[3].playerIndices.map(i => players[i].name).join(", ")}`);

    process.exit(0);
  } catch (error) {
    console.error("Seed failed:", error);
    process.exit(1);
  }
}

seed();
