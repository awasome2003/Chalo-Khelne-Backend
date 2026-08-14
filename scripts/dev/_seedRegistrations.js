/**
 * TEST SEED — registrations only (no groups, no matches) so the MANAGER FLOW can
 * be driven by hand: register → create groups → generate matches → score.
 *
 *  - Individual sports (Badminton, Table Tennis, Carrom, Chess): 4 individual
 *    player bookings each (real Users, sportSelections = that sport).
 *  - Team sport (Cricket): 4 team bookings (guest bookings carrying a `team`
 *    roster — read by the team flow / shown as team entrants).
 *
 * Idempotent: removes any prior tournament with the same title (+ its bookings)
 * first. Run from the server dir:   node _seedRegistrations.js
 * Optional: pass an existing tournament id to seed INTO it instead of creating
 * a fresh one:                       node _seedRegistrations.js <tournamentId>
 */
require("dotenv").config();
const mongoose = require("mongoose");
const OID = (s) => new mongoose.Types.ObjectId(s);
const newId = () => new mongoose.Types.ObjectId();

const MGR_ID = "6838358b4f831ea6854c479e";
const CLUB_ID = "67dd59de71d08e6633cd3531";
const TITLE = "🧪 MANAGER FLOW TEST — registrations only";

// Cricket is the team sport; the other four are individual.
const SPORTS = [
  { name: "Cricket",      sportId: "69b7ce0cf50e303a19ed6119", slug: "cricket",      scoringType: "innings", isTeam: true,
    mf: { scoringType: "innings", oversCount: 20, inningsCount: 2, superOver: true, totalSets: 2, setsToWin: 1, formatVersion: 1 } },
  { name: "Badminton",    sportId: "69b7ce0cf50e303a19ed610d", slug: "badminton",    scoringType: "sets",
    mf: { scoringType: "sets", totalSets: 3, setsToWin: 2, totalGames: 3, gamesToWin: 2, pointsToWinGame: 21, marginToWin: 2, deuceRule: true, maxPointsCap: 30, formatVersion: 1 } },
  { name: "Table Tennis", sportId: "69b7ce0cf50e303a19ed6110", slug: "table-tennis", scoringType: "sets",
    mf: { scoringType: "sets", totalSets: 3, setsToWin: 2, totalGames: 3, gamesToWin: 2, pointsToWinGame: 11, marginToWin: 2, deuceRule: true, formatVersion: 1 } },
  { name: "Carrom",       sportId: "69b7ce0cf50e303a19ed612e", slug: "carrom",       scoringType: "board",
    mf: { scoringType: "board", boardsToWin: 2, pointsPerBoard: 25, queenValue: 3, totalSets: 3, setsToWin: 2, formatVersion: 1 } },
  { name: "Chess",        sportId: "69b7ce0cf50e303a19ed612b", slug: "chess",         scoringType: "single",
    mf: { scoringType: "single", totalSets: 1, setsToWin: 1, formatVersion: 1 } },
];

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const Tournament = require("../../src/modules/tournaments/models/Tournament");
  const Booking = require("../../src/modules/tournaments/models/BookingModel");
  const BookingGroup = require("../../src/modules/tournaments/models/bookinggroup");
  const Match = require("../../src/modules/tournaments/models/Tournnamentmatch");
  const GroupStandings = require("../../src/modules/tournaments/models/GroupStandings");
  const User = require("../../src/modules/identity/models/User");

  const argId = process.argv[2] || null;

  // ── players (40 per individual sport, distinct; + team rosters) ──
  const PER_SPORT = 40;       // individual registrants per sport
  const NUM_TEAMS = 12;       // teams for the team sport
  const players = await User.find({ role: "Player" }).select("_id name userName").limit(260).lean();
  const needed = PER_SPORT * SPORTS.filter((s) => !s.isTeam).length;
  if (players.length < needed) throw new Error(`Need >=${needed} players in DB, found ${players.length}`);
  const pname = (p) => (p.name || p.userName || "Player").trim();

  // ── resolve / create the target tournament ──
  let tId;
  if (argId) {
    const t = await Tournament.findById(argId).select("_id title").lean();
    if (!t) throw new Error(`Tournament ${argId} not found`);
    tId = t._id;
    console.log("Seeding INTO existing tournament", String(tId), "—", t.title);
  } else {
    // remove prior runs of this seed
    const prior = await Tournament.find({ title: TITLE }).select("_id").lean();
    for (const p of prior) {
      await Booking.collection.deleteMany({ tournamentId: p._id });
      await Match.deleteMany({ tournamentId: p._id });
      await GroupStandings.deleteMany({ tournamentId: p._id });
      await BookingGroup.deleteMany({ tournamentId: p._id });
      await Tournament.deleteOne({ _id: p._id });
      console.log("Removed prior", String(p._id));
    }
    tId = newId();
    const sportsTracks = SPORTS.map((s) => ({
      _id: newId(), sportId: OID(s.sportId), sportName: s.name, sportSlug: s.slug,
      type: "group stage",
      categories: [{ _id: newId(), templateId: null, name: "Open", fee: 0, minAge: null, maxAge: null, gender: "any" }],
      groupStageFormat: "Singles", knockoutFormat: null, davisCupFormatId: null,
      qualifyPerGroup: 2, drawSize: null, tournamentLevel: "unranked",
      matchFormat: s.mf, sportRules: null, currentStage: "registration",
      stageConfig: { qualifierKnockout: { enabled: false, completed: false }, mainKnockout: { enabled: false, completed: false }, groupStage: { completed: false }, round2Format: null },
      createdAt: new Date(), updatedAt: new Date(),
    }));
    await Tournament.collection.insertOne({
      _id: tId, title: TITLE, tournamentLevel: "unranked",
      description: "Auto-seeded registrations for manager-flow QA (no groups/matches).",
      selectedTime: { startTime: "10:00", endTime: "18:00" },
      startDate: "2026-06-25", endDate: "2026-07-05",
      organizerName: "QA Seed", cancellationPolicy: "", eventLocation: ["Test Arena"],
      managerId: [OID(MGR_ID)], sports: sportsTracks,
      registrationDeadline: null, isPrivate: false, courts: [],
      clubId: OID(CLUB_ID), createdAt: new Date(), updatedAt: new Date(), __v: 0,
    });
    console.log("Created tournament", String(tId), "—", TITLE);
  }

  // ── clean slate for this tournament (registration-only) ──
  await Booking.collection.deleteMany({ tournamentId: tId });
  await Match.deleteMany({ tournamentId: tId });
  await GroupStandings.deleteMany({ tournamentId: tId });
  await BookingGroup.deleteMany({ tournamentId: tId });

  const baseBooking = (over) => ({
    _id: newId(), tournamentId: tId, tournamentName: TITLE, tournamentType: "group stage",
    status: "confirmed", paymentStatus: "paid", paymentAmount: 0, paymentMethod: "cash",
    clubId: OID(CLUB_ID), totalFee: 0, createdAt: new Date(), updatedAt: new Date(), __v: 0,
    ...over,
  });

  const bookings = [];

  // ── individual sports: 4 distinct players each (no roster overlap) ──
  const individual = SPORTS.filter((s) => !s.isTeam);
  let cursor = 0;
  for (const s of individual) {
    const group = players.slice(cursor, cursor + PER_SPORT);
    cursor += PER_SPORT;
    group.forEach((p) => {
      bookings.push(baseBooking({
        userId: p._id, userName: pname(p), isGuestBooking: false,
        sportSelections: [{ sportId: OID(s.sportId), sportName: s.name, categoryName: "Open", fee: 0 }],
      }));
    });
    console.log(`  • ${s.name.padEnd(13)} — ${group.length} individual players`);
  }

  // ── team sport (Cricket): 4 team bookings (guest, carry a roster) ──
  const team = SPORTS.find((s) => s.isTeam);
  if (team) {
    const teamNames = [
      "Royal Strikers", "Thunder Kings", "Phoenix XI", "Titan Warriors",
      "Desert Hawks", "Coastal Cyclones", "Iron Wolves", "Emerald Eagles",
      "Crimson Cobras", "Golden Gladiators", "Storm Riders", "Mystic Mavericks",
      "Vortex Vipers", "Blaze Blasters", "Summit Sultans", "Nova Knights",
    ].slice(0, NUM_TEAMS);
    teamNames.forEach((name, ti) => {
      // roster of 6 (reuse player names — rosters are plain strings, no unique key)
      const roster = [0, 1, 2, 3, 4, 5].map((k) => players[(ti * 6 + k) % players.length]);
      const captain = roster[0];
      bookings.push(baseBooking({
        userId: null, isGuestBooking: true, userName: name,
        sportSelections: [{ sportId: OID(team.sportId), sportName: team.name, categoryName: "Open", fee: 0 }],
        team: {
          name,
          captain: { name: pname(captain), id: String(captain._id), profileImage: "" },
          players: roster.slice(1, 5).map((p) => ({ name: pname(p), id: String(p._id), profileImage: "" })),
          substitutes: roster.slice(5).map((p) => ({ name: pname(p), id: String(p._id), profileImage: "" })),
          roster: roster.map((p, i) => ({ userId: String(p._id), name: pname(p), role: i === 0 ? "captain" : (i < 5 ? "player" : "substitute"), position: "", profileImage: "" })),
          teamSize: 6,
        },
      }));
    });
    console.log(`  • ${team.name.padEnd(13)} — ${teamNames.length} teams (roster of 6 each)`);
  }

  await Booking.collection.insertMany(bookings);

  console.log(`\n✅ DONE. ${bookings.length} confirmed registrations seeded.`);
  console.log("   Tournament:", String(tId));
  console.log("   Manager:    Akash Kamble (login as the manager to manage it).");
  console.log("   Open the group-stage manager for the 4 individual sports; the team flow for Cricket.");
  await mongoose.disconnect();
})().catch((e) => { console.error("SEED ERROR:", e); process.exit(1); });
