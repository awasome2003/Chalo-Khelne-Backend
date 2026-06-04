#!/usr/bin/env node
/**
 * Seed Script: Populate "The 2026 SpinMasters Summer Classic"
 *   (_id: 6a0feb0e4e01e9fb817707c1)
 * with players, confirmed bookings, round-robin groups, and team-event teams.
 *
 *   Open Singles: 42 players → 7 groups of 6 (qualifyPerGroup=3 → 21 advance)
 *   Team Event:   13 teams (captain + 2 squad members each)
 *
 * Tournament patches applied at seed time (additive, idempotent):
 *   - sports[0].categories += "Open Singles" (gender: any, no age cap)
 *   - sports[0].categories += "Team Event"
 *   - sports[0].knockoutFormat: "Singles" → "Davis Cup"
 *     (required so TeamKnockoutTeams docs have a valid bracket format)
 *
 * Idempotent: re-running deletes any users/bookings/groups/teams previously
 * created by this script (matched by email suffix on users, name pattern on
 * groups, and tournamentId on teams) before re-seeding.
 *
 * Usage:
 *   cd server && node scripts/seedSpinMasters.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("../Modal/User");
const Tournament = require("../Modal/Tournament");
const Booking = require("../Modal/BookingModel");
const BookingGroup = require("../Modal/bookinggroup");
const TeamKnockoutTeams = require("../Modal/TeamKnockoutTeams");

const TOURNAMENT_ID = "6a0feb0e4e01e9fb817707c1";
const EMAIL_SUFFIX = "@spinmasters2026.test";
const SINGLES_CATEGORY = "Open Singles";
const TEAM_CATEGORY = "Team Event";
const SINGLES_GROUP_SIZE = 6;
const MOBILE_BASE_SINGLES = 9600000000;
const MOBILE_BASE_TEAM_ONLY = 9650000000;

// 42 "Open Singles" players (mixed gender — Open Singles is gender: any).
// Order matches the user's source list; female names noted inline.
const SINGLES_PLAYERS = [
  { name: "Amol Ahuja",        sex: "male"   },
  { name: "Kaustubh Buge",     sex: "male"   },
  { name: "Anand Singh",       sex: "male"   },
  { name: "Ashwani",           sex: "male"   },
  { name: "Sahana",            sex: "female" },
  { name: "Tanvi Joshi",       sex: "female" },
  { name: "Atharva Chahar",    sex: "male"   },
  { name: "Mayank Rawat",      sex: "male"   },
  { name: "Prathamesh Naphade",sex: "male"   },
  { name: "Roushan Kumar",     sex: "male"   },
  { name: "Deepak Sharma",     sex: "male"   },
  { name: "Saurabh Ashutosh",  sex: "male"   },
  { name: "Shlok Bhurke",      sex: "male"   },
  { name: "Rohinton Todywalla",sex: "male"   },
  { name: "Chinmay Naik",      sex: "male"   },
  { name: "Nandkumar Jagtap",  sex: "male"   },
  { name: "Aastik Nagpal",     sex: "male"   },
  { name: "Arjun Vaid",        sex: "male"   },
  { name: "Manish Acharya",    sex: "male"   },
  { name: "Arun Chougule",     sex: "male"   },
  { name: "Dipak Dadhe",       sex: "male"   },
  { name: "Sarthak Tabhane",   sex: "male"   },
  { name: "Aadarsh Kadam",     sex: "male"   },
  { name: "Govinda Narke",     sex: "male"   },
  { name: "Aadiraj Narke",     sex: "male"   },
  { name: "Vijay Kakar",       sex: "male"   },
  { name: "Anvi Gala",         sex: "female" },
  { name: "Akhil Sehgal",      sex: "male"   },
  { name: "Samarth Chowksey",  sex: "male"   },
  { name: "Sagar Talekar",     sex: "male"   },
  { name: "Vandana Sharma",    sex: "female" },
  { name: "Shubhanshu Kushwah",sex: "male"   },
  { name: "Naveen Kumar",      sex: "male"   },
  { name: "Prashant Masuria",  sex: "male"   },
  { name: "Apoorv Pandey",     sex: "male"   },
  { name: "Bhargav Gejji",     sex: "male"   },
  { name: "Shachin B",         sex: "male"   },
  { name: "Saad Vakil",        sex: "male"   },
  { name: "Meet",              sex: "male"   },
  { name: "Aafran Khan",       sex: "male"   },
  { name: "Shaunak Kumar",     sex: "male"   },
  { name: "Suhrut Kumar",      sex: "male"   },
];

// 13 teams. captainName resolves to a singles player when possible; the four
// listed under EXTRA_CAPTAINS are not in the singles roster, so the script
// creates dedicated User accounts for them below.
const TEAMS = [
  { teamName: "Amol's Team",        captainName: "Amol Ahuja"          },
  { teamName: "Ashwani's Team",     captainName: "Ashwani"             },
  { teamName: "Team SRT",           captainName: "SRT Captain"         },
  { teamName: "Reetam's Team",      captainName: "Reetam"              },
  { teamName: "Prathamesh's Team",  captainName: "Prathamesh Naphade"  },
  { teamName: "Mayank's Team",      captainName: "Mayank Rawat"        },
  { teamName: "Purushottam's Team", captainName: "Purushottam"         },
  { teamName: "Atharva's Team",     captainName: "Atharva Chahar"      },
  { teamName: "Sarthak's Team",     captainName: "Sarthak Tabhane"     },
  { teamName: "Aadarsh's Team",     captainName: "Aadarsh Kadam"       },
  { teamName: "Shubhanshu's Team",  captainName: "Shubhanshu Kushwah"  },
  { teamName: "Aadiraj's Team",     captainName: "Aadiraj Narke"       },
  { teamName: "Inder's Team",       captainName: "Inder"               },
];

const EXTRA_CAPTAINS = ["SRT Captain", "Reetam", "Purushottam", "Inder"];

const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");

async function ensureCategory(tournament, sportTrackIdx, name, extras = {}) {
  const cats = tournament.sports[sportTrackIdx].categories;
  const existing = cats.find((c) => c.name === name);
  if (existing) return existing;
  cats.push({
    templateId: null,
    name,
    fee: 0,
    minAge: null,
    maxAge: null,
    gender: "any",
    ...extras,
  });
  return cats[cats.length - 1];
}

async function seed() {
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

  // ── 1. Patch tournament: categories + knockoutFormat ──
  const singlesCat = await ensureCategory(tournament, trackIdx, SINGLES_CATEGORY);
  const teamCat    = await ensureCategory(tournament, trackIdx, TEAM_CATEGORY);
  let patched = false;
  if (track.knockoutFormat !== "Davis Cup") {
    track.knockoutFormat = "Davis Cup";
    patched = true;
  }
  tournament.markModified("sports");
  await tournament.save();
  console.log(`✓ Categories: ensured "${SINGLES_CATEGORY}" + "${TEAM_CATEGORY}"`);
  if (patched) console.log(`✓ knockoutFormat: switched to "Davis Cup"`);
  console.log("");

  // ── 2. Cleanup prior seed runs (idempotent) ──
  const oldUsers = await User.find({ email: { $regex: EMAIL_SUFFIX + "$" } }, "_id email");
  if (oldUsers.length > 0) {
    const ids = oldUsers.map((u) => u._id);
    await Booking.deleteMany({ userId: { $in: ids } });
    await User.deleteMany({ _id: { $in: ids } });
    console.log(`✓ Cleaned up ${oldUsers.length} prior seed users + bookings`);
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
    console.log(`✓ Cleaned up ${oldGroupCount} prior booking groups`);
  }
  const oldTeamCount = await TeamKnockoutTeams.countDocuments({ tournamentId: tournament._id });
  if (oldTeamCount > 0) {
    await TeamKnockoutTeams.deleteMany({ tournamentId: tournament._id });
    console.log(`✓ Cleaned up ${oldTeamCount} prior team-event teams`);
  }
  console.log("");

  const hashedPassword = await bcrypt.hash("sport123", 10);

  // ── 3. Open Singles: 42 players ──
  console.log(`${"═".repeat(60)}`);
  console.log(`  OPEN SINGLES · ${SINGLES_PLAYERS.length} players`);
  console.log(`${"═".repeat(60)}`);

  if (SINGLES_PLAYERS.length % SINGLES_GROUP_SIZE !== 0) {
    console.error(`✗ ${SINGLES_PLAYERS.length} players doesn't divide evenly into groups of ${SINGLES_GROUP_SIZE}`);
    process.exit(1);
  }
  const groupCount = SINGLES_PLAYERS.length / SINGLES_GROUP_SIZE;

  const singlesUsers = [];
  for (let i = 0; i < SINGLES_PLAYERS.length; i++) {
    const { name, sex } = SINGLES_PLAYERS[i];
    const user = await User.create({
      name,
      email: `${slugify(name)}.s${EMAIL_SUFFIX}`,
      mobile: String(MOBILE_BASE_SINGLES + i + 1),
      dateOfBirth: new Date(1988 + (i % 18), i % 12, ((i % 27) + 1)),
      sex,
      age: 20 + ((i * 3) % 25),
      password: hashedPassword,
      role: "player",
      isApproved: true,
      playerId: `SMS${String(i + 1).padStart(3, "0")}`,
    });
    singlesUsers.push(user);
  }
  console.log(`  ✓ Players: ${singlesUsers.length}`);

  for (const user of singlesUsers) {
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
      paymentAmount: singlesCat.fee ?? 0,
      paymentMethod: "cash",
      sportSelections: [{
        sportId: track.sportId,
        sportName: track.sportName,
        categoryName: SINGLES_CATEGORY,
        fee: singlesCat.fee ?? 0,
      }],
      totalFee: singlesCat.fee ?? 0,
    });
  }
  console.log(`  ✓ Bookings: ${singlesUsers.length}`);

  for (let g = 0; g < groupCount; g++) {
    const groupName = `Group ${String.fromCharCode(65 + g)}`;
    const slice = singlesUsers.slice(g * SINGLES_GROUP_SIZE, (g + 1) * SINGLES_GROUP_SIZE);
    const players = slice.map((u) => ({
      playerId: u._id,
      userName: u.name,
      bookingDate: new Date(),
      joinedAt: new Date(),
    }));
    await BookingGroup.create({
      tournamentId: tournament._id,
      sportId: track.sportId,
      groupName,
      category: SINGLES_CATEGORY,
      players,
      matchFormat: track.matchFormat,
    });
    const firstNames = slice.map((u) => u.name.split(" ")[0]).join(", ");
    console.log(`  ✓ ${groupName}: ${firstNames}`);
  }
  console.log("");

  // ── 4. Team Event: 13 teams ──
  console.log(`${"═".repeat(60)}`);
  console.log(`  TEAM EVENT · ${TEAMS.length} teams`);
  console.log(`${"═".repeat(60)}`);

  // Extra captain accounts for the 4 captains not in the singles roster.
  const extraCaptainUsers = {};
  for (let i = 0; i < EXTRA_CAPTAINS.length; i++) {
    const name = EXTRA_CAPTAINS[i];
    const user = await User.create({
      name,
      email: `${slugify(name)}.cap${EMAIL_SUFFIX}`,
      mobile: String(MOBILE_BASE_TEAM_ONLY + i + 1),
      dateOfBirth: new Date(1985 + i, (i * 2) % 12, ((i * 3) % 27) + 1),
      sex: "male",
      age: 30 + i,
      password: hashedPassword,
      role: "player",
      isApproved: true,
      playerId: `SMT${String(i + 1).padStart(3, "0")}`,
    });
    extraCaptainUsers[name] = user;
  }
  console.log(`  ✓ Extra captain accounts: ${EXTRA_CAPTAINS.length}`);

  const singlesByName = new Map(singlesUsers.map((u) => [u.name, u]));
  const lookupUser = (name) => singlesByName.get(name) || extraCaptainUsers[name];

  // Squad rotation pulls non-captain players from the singles pool round-robin
  // so each team has 2 distinct squad members and load is spread evenly.
  let squadCursor = 0;
  const pickSquad = (excludeName, count = 2) => {
    const picks = [];
    let attempts = 0;
    while (picks.length < count && attempts < singlesUsers.length * 2) {
      const candidate = singlesUsers[squadCursor % singlesUsers.length];
      squadCursor++;
      attempts++;
      if (candidate.name === excludeName) continue;
      if (picks.some((p) => p.name === candidate.name)) continue;
      picks.push(candidate);
    }
    return picks;
  };

  for (const team of TEAMS) {
    const captain = lookupUser(team.captainName);
    if (!captain) {
      console.warn(`  ✗ ${team.teamName}: captain "${team.captainName}" not found, skipping`);
      continue;
    }

    // Each team needs an originalBookingId — create a dedicated Team Event
    // booking for the captain (separate from any Open Singles booking).
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

    const squad = pickSquad(captain.name, 2);
    const player1 = squad[0];
    const player2 = squad[1];

    await TeamKnockoutTeams.create({
      tournamentId: tournament._id,
      originalBookingId: captainBooking._id,
      teamName: team.teamName,
      playerPositions: {
        A: captain.name,
        B: player1?.name || "TBD",
        C: player2?.name || undefined,
      },
      roster: [
        { userId: captain._id, name: captain.name, role: "captain" },
        ...(player1 ? [{ userId: player1._id, name: player1.name, role: "player" }] : []),
        ...(player2 ? [{ userId: player2._id, name: player2.name, role: "player" }] : []),
      ],
      teamSize: 3,
      status: "ACTIVE",
    });
    console.log(`  ✓ ${team.teamName.padEnd(22)} captain: ${captain.name} | squad: ${player1?.name}, ${player2?.name}`);
  }
  console.log("");

  // ── Summary ──
  console.log(`${"═".repeat(60)}`);
  console.log("  SEED COMPLETE");
  console.log(`${"═".repeat(60)}`);
  console.log(`  Tournament: ${tournament.title}`);
  console.log(`  ID:         ${tournament._id}`);
  console.log("");
  console.log(`  Open Singles: ${singlesUsers.length} players, ${groupCount} groups of ${SINGLES_GROUP_SIZE}`);
  console.log(`                qualifyPerGroup=${track.qualifyPerGroup} → ${groupCount * track.qualifyPerGroup} advance to knockout`);
  console.log(`  Team Event:   ${TEAMS.length} teams (captain + 2 squad each)`);
  console.log("");
  console.log(`  Login:        <slug>.s${EMAIL_SUFFIX}        (Open Singles players)`);
  console.log(`                <slug>.cap${EMAIL_SUFFIX}      (extra team captains)`);
  console.log(`  Password:     sport123`);
  console.log("");
  console.log("  Next: Tournament Management → Group Stage → Generate Matches");

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("✗ Seed failed:", err);
  process.exit(1);
});
