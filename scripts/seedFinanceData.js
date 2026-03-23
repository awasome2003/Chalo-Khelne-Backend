/**
 * Seed script for Club Admin Financial Overview testing
 * Creates: 2 managers, 4 tournaments, turf bookings, and player registrations
 * Under Club Admin: bisogi8153@paylaar.com (69bd1d70bfaa7aa856eab464)
 */

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { Manager } = require("../Modal/ClubManager");
const Tournament = require("../Modal/Tournament");
const Booking = require("../Modal/BookingModel");
const Turf = require("../Modal/Turf");
const TurfBooking = require("../Modal/TurfBooking");
const User = require("../Modal/User");

const CLUB_ADMIN_ID = "69bd1d70bfaa7aa856eab464";

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to DB");

  // Get existing manager (tony stark)
  const existingManager = await Manager.findOne({ clubId: CLUB_ADMIN_ID });
  console.log("Existing manager:", existingManager?.name);

  // ===== CREATE 2 NEW MANAGERS =====
  const hashedPwd = await bcrypt.hash("manager123", 10);

  const manager1 = await Manager.findOneAndUpdate(
    { email: "rahul.manager@test.com" },
    {
      name: "Rahul Sharma",
      email: "rahul.manager@test.com",
      password: hashedPwd,
      clubId: CLUB_ADMIN_ID,
      isActive: true,
    },
    { upsert: true, new: true }
  );
  console.log("Manager 1:", manager1.name, manager1._id);

  const manager2 = await Manager.findOneAndUpdate(
    { email: "priya.manager@test.com" },
    {
      name: "Priya Patel",
      email: "priya.manager@test.com",
      password: hashedPwd,
      clubId: CLUB_ADMIN_ID,
      isActive: true,
    },
    { upsert: true, new: true }
  );
  console.log("Manager 2:", manager2.name, manager2._id);

  // ===== CREATE TOURNAMENTS =====
  const allManagers = [existingManager, manager1, manager2].filter(Boolean);

  const tournamentData = [
    {
      title: "State Badminton Championship 2026",
      sportsType: "Badminton",
      type: "group stage",
      managerId: [manager1._id],
      startDate: "2026-04-01",
      endDate: "2026-04-05",
      maxTeams: 32,
      category: [
        { name: "Men's Singles", fee: 500 },
        { name: "Women's Singles", fee: 500 },
        { name: "Men's Doubles", fee: 800 },
        { name: "Mixed Doubles", fee: 800 },
      ],
    },
    {
      title: "Inter-Club Table Tennis League",
      sportsType: "Table Tennis",
      type: "knockout",
      managerId: [manager1._id],
      startDate: "2026-04-10",
      endDate: "2026-04-12",
      maxTeams: 16,
      category: [
        { name: "Open Category", fee: 300 },
        { name: "Under-19", fee: 200 },
      ],
    },
    {
      title: "City Cricket Tournament",
      sportsType: "Cricket",
      type: "knockout",
      managerId: [manager2._id],
      startDate: "2026-05-01",
      endDate: "2026-05-10",
      maxTeams: 8,
      category: [
        { name: "T20 Format", fee: 2000 },
        { name: "T10 Format", fee: 1500 },
      ],
    },
    {
      title: "Weekend Football Cup",
      sportsType: "Football",
      type: "group stage",
      managerId: [manager2._id],
      startDate: "2026-03-01",
      endDate: "2026-03-03",
      maxTeams: 12,
      category: [
        { name: "Open", fee: 1000 },
      ],
    },
  ];

  // Also add a tournament for existing manager (tony stark)
  if (existingManager) {
    tournamentData.push({
      title: "Tony's Invitational Badminton Open",
      sportsType: "Badminton",
      type: "knockout",
      managerId: [existingManager._id],
      startDate: "2026-04-15",
      endDate: "2026-04-17",
      maxTeams: 16,
      category: [
        { name: "Singles", fee: 400 },
        { name: "Doubles", fee: 600 },
      ],
    });
  }

  const tournaments = [];
  for (const t of tournamentData) {
    const tournament = await Tournament.findOneAndUpdate(
      { title: t.title },
      t,
      { upsert: true, new: true }
    );
    tournaments.push(tournament);
    console.log("Tournament:", tournament.title, "| ID:", tournament._id);
  }

  // ===== GET SOME PLAYERS FOR BOOKINGS =====
  const players = await User.find({ role: { $in: ["Player", "player"] } })
    .select("name email mobile")
    .limit(10)
    .lean();

  if (players.length === 0) {
    console.log("No players found — creating dummy players");
    const dummyNames = [
      "Arjun Kumar", "Sneha Reddy", "Vikram Singh", "Ananya Iyer",
      "Rohit Patil", "Kavya Nair", "Aditya Joshi", "Meera Das",
    ];
    for (const name of dummyNames) {
      const email = name.toLowerCase().replace(/\s/g, ".") + "@test.com";
      const p = await User.findOneAndUpdate(
        { email },
        {
          name,
          email,
          password: hashedPwd,
          role: "Player",
          isApproved: true,
          authProvider: "local",
          emailVerified: true,
        },
        { upsert: true, new: true }
      );
      players.push(p);
    }
  }
  console.log("Players available:", players.length);

  // ===== CREATE BOOKINGS (TOURNAMENT REGISTRATIONS) =====
  let bookingCount = 0;

  for (const tournament of tournaments) {
    const categories = tournament.category || [];
    // Register 3-6 players per tournament
    const numBookings = Math.min(players.length, 3 + Math.floor(Math.random() * 4));

    for (let i = 0; i < numBookings; i++) {
      const player = players[i % players.length];
      // Pick 1-2 random categories
      const numCats = Math.min(categories.length, 1 + Math.floor(Math.random() * 2));
      const selectedCats = categories.slice(0, numCats).map((c) => ({
        name: c.name,
        price: c.fee,
        id: c._id?.toString() || "",
      }));

      const totalFee = selectedCats.reduce((sum, c) => sum + c.price, 0);
      const isPaid = Math.random() > 0.2; // 80% paid
      const isConfirmed = isPaid ? true : Math.random() > 0.5;

      await Booking.findOneAndUpdate(
        {
          tournamentId: tournament._id,
          userId: player._id,
        },
        {
          userId: player._id,
          userName: player.name,
          userEmail: player.email,
          userPhone: player.mobile || "9999999999",
          tournamentId: tournament._id,
          tournamentName: tournament.title,
          tournamentType: tournament.type,
          status: isConfirmed ? "confirmed" : "pending",
          paymentStatus: isPaid ? "paid" : "pending",
          paymentAmount: isPaid ? totalFee : 0,
          paymentMethod: isPaid ? (Math.random() > 0.5 ? "online" : "cash") : "cash",
          selectedCategories: selectedCats,
          team: {
            name: `Team ${player.name.split(" ")[0]}`,
            captain: { name: player.name, id: player._id?.toString() },
          },
        },
        { upsert: true, new: true }
      );
      bookingCount++;
    }
  }
  console.log("Tournament bookings created:", bookingCount);

  // ===== CREATE TURF BOOKINGS =====
  // Find turfs owned by these managers
  const managerIds = allManagers.map((m) => m._id);
  let turfs = await Turf.find({ owner: { $in: managerIds } }).lean();

  if (turfs.length === 0) {
    console.log("No turfs found for managers — assigning existing turfs");
    // Assign first 2 turfs to our managers
    const allTurfs = await Turf.find().limit(3).lean();
    for (let i = 0; i < allTurfs.length && i < allManagers.length; i++) {
      await Turf.findByIdAndUpdate(allTurfs[i]._id, { owner: allManagers[i]._id });
      allTurfs[i].owner = allManagers[i]._id;
    }
    turfs = allTurfs;
  }

  let turfBookingCount = 0;
  const sports = ["Badminton", "Cricket", "Football"];
  const timeSlots = ["06:00 - 07:00", "07:00 - 08:00", "08:00 - 09:00", "17:00 - 18:00", "18:00 - 19:00", "19:00 - 20:00"];

  for (const turf of turfs) {
    // Create 5-8 bookings per turf
    const numBookings = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < numBookings; i++) {
      const player = players[i % players.length];
      const sport = sports[i % sports.length];
      const price = 400 + Math.floor(Math.random() * 600); // 400-1000
      const day = 1 + Math.floor(Math.random() * 28);
      const month = 2 + Math.floor(Math.random() * 2); // March or April
      const date = new Date(2026, month, day);
      const isConfirmed = Math.random() > 0.15;
      const isCancelled = !isConfirmed && Math.random() > 0.5;

      await TurfBooking.create({
        userId: player._id,
        userName: player.name,
        userEmail: player.email,
        userPhone: player.mobile || "9999999999",
        turfId: turf._id,
        turfName: turf.name,
        sport: { name: sport, pricePerHour: price },
        date,
        timeSlot: timeSlots[i % timeSlots.length],
        amount: price,
        status: isCancelled ? "cancelled" : isConfirmed ? "confirmed" : "pending",
        paymentStatus: isConfirmed ? "paid" : "pending",
        paymentMethod: "cash",
      });
      turfBookingCount++;
    }
  }
  console.log("Turf bookings created:", turfBookingCount);

  // ===== SUMMARY =====
  console.log("\n===== SEED COMPLETE =====");
  console.log("Club Admin ID:", CLUB_ADMIN_ID);
  console.log("Managers:", allManagers.length);
  allManagers.forEach((m) => console.log("  -", m.name, "|", m._id));
  console.log("Tournaments:", tournaments.length);
  tournaments.forEach((t) => console.log("  -", t.title, "| Categories:", t.category.length));
  console.log("Tournament Bookings:", bookingCount);
  console.log("Turf Bookings:", turfBookingCount);
  console.log("\nLogin as Club Admin: bisogi8153@paylaar.com / p22092003");
  console.log("Go to: Financial Overview in sidebar");

  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
