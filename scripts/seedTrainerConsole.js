/*
 * Seeds the Trainer Console:
 *   - Club directory (Find Clubs)
 *   - For one real user (treated as "the trainer"): a Trainer profile,
 *     today's sessions, batches, pending player requests, club invites.
 *
 * Run:  node scripts/seedTrainerConsole.js
 * Idempotent: clubs upsert by name; per-trainer docs created only if absent.
 */

const mongoose = require("mongoose");
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const Trainer = require("../src/modules/org/models/Trainer");
const Session = require("../src/modules/org/models/Session");
const Request = require("../src/modules/org/models/Request");
const Club = require("../src/modules/org/models/Club");
const ClubRequest = require("../src/modules/org/models/ClubRequest");
const TrainerBatch = require("../src/modules/org/models/TrainerBatch");
const User = require("../src/modules/identity/models/User");

const CLUBS = [
  {
    name: "Bengaluru Sports Academy",
    shortCode: "BSA",
    logoColor: "#15A765",
    location: "Koramangala, Bangalore",
    membersCount: 840,
    sports: ["Cricket", "Football", "Athletics"],
    amenities: ["gym", "pool", "parking", "wifi"],
    isHiring: true,
  },
  {
    name: "Victory Cricket Club",
    shortCode: "VCC",
    logoColor: "#2563EB",
    location: "Indiranagar, Bangalore",
    membersCount: 320,
    sports: ["Cricket", "Fitness"],
    amenities: ["gym", "parking"],
    isHiring: true,
  },
  {
    name: "Aqua Arena Sports Club",
    shortCode: "AA",
    logoColor: "#0E9AA7",
    location: "Whitefield, Bangalore",
    membersCount: 620,
    sports: ["Swimming", "Tennis", "Badminton"],
    amenities: ["pool", "gym", "wifi", "parking"],
    isHiring: false,
  },
  {
    name: "Elite Football Academy",
    shortCode: "EFA",
    logoColor: "#F26B1F",
    location: "HSR Layout, Bangalore",
    membersCount: 450,
    sports: ["Football"],
    amenities: ["gym", "parking"],
    isHiring: true,
  },
  {
    name: "Smash Badminton Center",
    shortCode: "SBC",
    logoColor: "#8200DB",
    location: "Jayanagar, Bangalore",
    membersCount: 280,
    sports: ["Badminton"],
    amenities: ["parking", "wifi"],
    isHiring: false,
  },
];

const todayAt = (h, m = 0) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
};
// A date `offset` months from now, on `day`, at h:00 (used for past earnings)
const monthDay = (offset, day, h = 9) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + offset, day, h, 0, 0, 0);
};

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    // ── Clubs ──
    let cCreated = 0;
    let cUpdated = 0;
    const clubDocs = [];
    for (const club of CLUBS) {
      const existing = await Club.findOne({ name: club.name });
      if (existing) {
        await Club.updateOne({ _id: existing._id }, { $set: club });
        clubDocs.push(existing);
        cUpdated++;
      } else {
        clubDocs.push(await Club.create(club));
        cCreated++;
      }
    }
    console.log(`Clubs: ${cCreated} created, ${cUpdated} updated.`);

    // ── Pick a user to be "the trainer" ──
    const user = await User.findOne({ isActive: true }).sort({ updatedAt: -1 }).select("_id name").lean();
    if (!user) {
      console.log("No users found — seeded clubs only.");
      process.exit(0);
    }
    const userId = user._id;
    console.log(`Trainer user: ${user.name} (${userId})`);

    // Ensure Trainer profile
    let trainer = await Trainer.findOne({ userId });
    if (!trainer) {
      const parts = (user.name || "Trainer").trim().split(/\s+/);
      trainer = await Trainer.create({
        userId,
        firstName: parts[0] || "Trainer",
        lastName: parts.slice(1).join(" "),
        sports: ["Football", "Cricket"],
      });
      console.log("Created Trainer profile.");
    }

    // ── Sessions (today) ──
    if ((await Session.countDocuments({ trainerId: trainer._id })) === 0) {
      await Session.create([
        {
          title: "Morning Drills",
          type: "group",
          startTime: todayAt(8, 0),
          endTime: todayAt(9, 0),
          location: "Green Valley Ground, Sector 12",
          trainerId: trainer._id,
          sportType: "Football",
          maxParticipants: 10,
          currentParticipants: 6,
          price: 500,
          status: "scheduled",
        },
        {
          title: "Singles Practice",
          type: "personal",
          startTime: todayAt(10, 30),
          endTime: todayAt(11, 30),
          location: "Indoor Sports Complex, Hall 3",
          trainerId: trainer._id,
          sportType: "Tennis",
          maxParticipants: 1,
          currentParticipants: 2,
          price: 800,
          status: "in-progress",
        },
        {
          title: "Stroke Technique",
          type: "group",
          startTime: todayAt(16, 0),
          endTime: todayAt(17, 0),
          location: "City Cricket Academy, Block B",
          trainerId: trainer._id,
          sportType: "Swimming",
          maxParticipants: 8,
          currentParticipants: 4,
          price: 600,
          status: "completed",
        },
        // ── completed sessions (this month) — drive Earnings ──
        {
          title: "Personal Session – Arjun K.",
          type: "personal",
          startTime: monthDay(0, 4, 7),
          endTime: monthDay(0, 4, 8),
          location: "Green Valley Ground",
          trainerId: trainer._id,
          sportType: "Football",
          maxParticipants: 1,
          currentParticipants: 1,
          price: 1500,
          status: "completed",
        },
        {
          title: "Group Session – 6 Players",
          type: "group",
          startTime: monthDay(0, 6, 7),
          endTime: monthDay(0, 6, 9),
          location: "City Cricket Academy",
          trainerId: trainer._id,
          sportType: "Cricket",
          maxParticipants: 8,
          currentParticipants: 6,
          price: 4800,
          status: "completed",
        },
        {
          title: "Mumbai FC – Monthly Retainer",
          type: "group",
          startTime: monthDay(0, 9, 8),
          endTime: monthDay(0, 9, 10),
          location: "Mumbai FC Ground",
          trainerId: trainer._id,
          clubId: clubDocs[1]._id,
          sportType: "Football",
          maxParticipants: 20,
          currentParticipants: 18,
          price: 40000,
          status: "completed",
        },
        {
          title: "Academy Workshop – Pune",
          type: "academy",
          startTime: monthDay(0, 11, 16),
          endTime: monthDay(0, 11, 18),
          location: "Pune Academy",
          trainerId: trainer._id,
          sportType: "Badminton",
          maxParticipants: 30,
          currentParticipants: 22,
          price: 7500,
          status: "completed",
        },
        // ── completed sessions (last month) — for the % comparison + Last Month tab ──
        {
          title: "Match Prep – Vikram S.",
          type: "personal",
          startTime: monthDay(-1, 18, 9),
          endTime: monthDay(-1, 18, 10),
          location: "Juhu Tennis Club",
          trainerId: trainer._id,
          sportType: "Tennis",
          maxParticipants: 1,
          currentParticipants: 1,
          price: 2500,
          status: "completed",
        },
        {
          title: "Club Practice – Victory CC",
          type: "group",
          startTime: monthDay(-1, 22, 7),
          endTime: monthDay(-1, 22, 9),
          location: "Victory Cricket Club",
          trainerId: trainer._id,
          clubId: clubDocs[1]._id,
          sportType: "Cricket",
          maxParticipants: 16,
          currentParticipants: 12,
          price: 32000,
          status: "completed",
        },
        // ── pending (scheduled, this month) ──
        {
          title: "Stroke Technique – Day 2",
          type: "group",
          startTime: monthDay(0, 28, 16),
          endTime: monthDay(0, 28, 17),
          location: "City Cricket Academy, Block B",
          trainerId: trainer._id,
          sportType: "Swimming",
          maxParticipants: 8,
          currentParticipants: 4,
          price: 35000,
          status: "scheduled",
        },
      ]);
      console.log("Created sessions (today + earnings history).");
    } else {
      console.log("Sessions already present — skipped.");
    }

    // ── Batches ──
    if ((await TrainerBatch.countDocuments({ trainerId: userId })) === 0) {
      await TrainerBatch.create([
        {
          trainerId: userId,
          name: "Morning Football Elite",
          sport: "Football",
          level: "advanced",
          capacity: 18,
          enrolledCount: 14,
          scheduleDays: ["Mon", "Wed", "Fri"],
          startTime: "6:00 AM",
          endTime: "7:30 AM",
          location: "Green Valley Ground, Sector 12",
        },
        {
          trainerId: userId,
          name: "Junior Cricket Batch",
          sport: "Cricket",
          level: "kids",
          capacity: 15,
          enrolledCount: 10,
          scheduleDays: ["Tue", "Thu", "Sat"],
          startTime: "7:00 AM",
          endTime: "8:30 AM",
          location: "City Cricket Academy, Block B",
        },
        {
          trainerId: userId,
          name: "Badminton Beginners",
          sport: "Badminton",
          level: "beginner",
          capacity: 20,
          enrolledCount: 8,
          scheduleDays: ["Mon", "Wed"],
          startTime: "5:00 PM",
          endTime: "6:30 PM",
          location: "Indoor Sports Complex, Hall 3",
        },
      ]);
      console.log("Created 3 batches.");
    } else {
      console.log("Batches already present — skipped.");
    }

    // ── Player requests ──
    if ((await Request.countDocuments({ trainerId: userId, type: "player" })) === 0) {
      await Request.create([
        {
          type: "player",
          playerName: "Arjun Kapoor",
          trainerId: userId,
          requestType: "new_session",
          requestedDate: "30 May 2026",
          requestedTime: "6:00 AM",
          sessionType: "personal",
          location: "Santacruz Sports Ground",
          notes: "Focus on dribbling and fitness drills. Need evaluation for upcoming league.",
          sportType: "Football",
          status: "pending",
        },
        {
          type: "player",
          playerName: "Sneha Nair",
          trainerId: userId,
          requestType: "new_session",
          requestedDate: "1 Jun 2026",
          requestedTime: "7:30 AM",
          sessionType: "personal",
          location: "Juhu Tennis Club",
          notes: "Tournament is on 5th June. Need intensive match preparation and serve training.",
          sportType: "Tennis",
          status: "pending",
        },
      ]);
      console.log("Created 2 player requests.");
    } else {
      console.log("Player requests already present — skipped.");
    }

    // ── Club invites (kind=invite) ──
    if ((await ClubRequest.countDocuments({ trainerId: userId, kind: "invite" })) === 0) {
      await ClubRequest.create([
        {
          trainerId: userId,
          clubId: clubDocs[0]._id,
          clubName: clubDocs[0].name,
          sport: "Football",
          kind: "invite",
          status: "pending",
          message: "We'd love to have you coach our advanced football batch.",
        },
        {
          trainerId: userId,
          clubId: clubDocs[1]._id,
          clubName: clubDocs[1].name,
          sport: "Cricket",
          kind: "invite",
          status: "pending",
          message: "Opening for a cricket coach on weekends.",
        },
      ]);
      console.log("Created 2 club invites.");
    } else {
      console.log("Club invites already present — skipped.");
    }

    console.log("\nDone.");
    process.exit(0);
  } catch (err) {
    console.error("Seed error:", err);
    process.exit(1);
  }
}

seed();
