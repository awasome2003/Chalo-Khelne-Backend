/**
 * PHASE 1 SEED — a ready-to-run Foosball event (corporate client, Jul 6-10).
 * Config locked with client: Both Singles + Doubles categories, best-of-3 games
 * to 10 goals (win by 2), Group stage + Knockout, 1 table (1 court).
 * Scored via the "sets" engine (goals = points), same as Badminton/TT.
 *
 * Registrations only (no groups/matches) so the manager drives the flow.
 * Idempotent. Run from server dir:  node _seedFoosball.js [tournamentId]
 */
require("dotenv").config();
const mongoose = require("mongoose");
const OID = (s) => new mongoose.Types.ObjectId(s);
const newId = () => new mongoose.Types.ObjectId();

const MGR_ID = "6838358b4f831ea6854c479e";
const CLUB_ID = "67dd59de71d08e6633cd3531";
const FOOSBALL_SPORT_ID = "6a3a88073dd3695d0674f65b";
const TITLE = "🎮 FOOSBALL TEST — Singles + Doubles";

// Best-of-3 games to 10 GOALS (win by 2). scoringType "sets" → set engine.
const MF = {
  scoringType: "sets", totalSets: 3, setsToWin: 2, totalGames: 3, gamesToWin: 2,
  pointsToWinGame: 10, marginToWin: 2, deuceRule: false, formatVersion: 1,
};
const SINGLES_COUNT = 8;
const DOUBLES_COUNT = 8; // pairs

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const Tournament = require("../../src/modules/tournaments/models/Tournament");
  const Booking = require("../../src/modules/tournaments/models/BookingModel");
  const BookingGroup = require("../../src/modules/tournaments/models/bookinggroup");
  const Match = require("../../src/modules/tournaments/models/Tournnamentmatch");
  const GroupStandings = require("../../src/modules/tournaments/models/GroupStandings");
  const User = require("../../src/modules/identity/models/User");

  const players = await User.find({ role: "Player" }).select("_id name userName").limit(40).lean();
  if (players.length < SINGLES_COUNT + DOUBLES_COUNT * 2) throw new Error("Not enough players");
  const pname = (p) => (p.name || p.userName || "Player").trim();

  // ── tournament (group stage + knockout, two categories) ──
  let tId = process.argv[2] ? OID(process.argv[2]) : null;
  if (!tId) {
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
    const mkCat = (name) => ({ _id: newId(), templateId: null, name, fee: 0, minAge: null, maxAge: null, gender: "any" });
    await Tournament.collection.insertOne({
      _id: tId, title: TITLE, tournamentLevel: "unranked",
      description: "Foosball — Singles + Doubles, best-of-3 to 10 goals, group + knockout, 1 table.",
      selectedTime: { startTime: "10:00", endTime: "18:00" },
      startDate: "2026-07-06", endDate: "2026-07-10",
      organizerName: "Corporate Client", cancellationPolicy: "", eventLocation: ["Office Arena"],
      managerId: [OID(MGR_ID)],
      sports: [{
        _id: newId(), sportId: OID(FOOSBALL_SPORT_ID), sportName: "Foosball", sportSlug: "foosball",
        type: "knockout + group stage",
        categories: [mkCat("Singles"), mkCat("Doubles")],
        groupStageFormat: "Singles", knockoutFormat: "Singles", davisCupFormatId: null,
        qualifyPerGroup: 2, drawSize: null, tournamentLevel: "unranked",
        matchFormat: MF, sportRules: null, currentStage: "registration",
        stageConfig: { qualifierKnockout: { enabled: false, completed: false }, mainKnockout: { enabled: false, completed: false }, groupStage: { completed: false }, round2Format: null },
        createdAt: new Date(), updatedAt: new Date(),
      }],
      registrationDeadline: null, isPrivate: false,
      // 1 foosball table = 1 court (drives scheduling)
      courts: [{ _id: newId(), name: "Table 1", sportId: OID(FOOSBALL_SPORT_ID) }],
      clubId: OID(CLUB_ID), createdAt: new Date(), updatedAt: new Date(), __v: 0,
    });
    console.log("Created Foosball tournament", String(tId));
  } else {
    console.log("Seeding INTO", String(tId));
  }

  await Booking.collection.deleteMany({ tournamentId: tId });
  await Match.deleteMany({ tournamentId: tId });
  await GroupStandings.deleteMany({ tournamentId: tId });
  await BookingGroup.deleteMany({ tournamentId: tId });

  const base = (over) => ({
    _id: newId(), tournamentId: tId, tournamentName: TITLE, tournamentType: "knockout + group stage",
    status: "confirmed", paymentStatus: "paid", paymentAmount: 0, paymentMethod: "cash",
    clubId: OID(CLUB_ID), totalFee: 0, createdAt: new Date(), updatedAt: new Date(), __v: 0, ...over,
  });

  const bookings = [];
  let cur = 0;
  // Singles — individual players
  for (let i = 0; i < SINGLES_COUNT; i++) {
    const p = players[cur++];
    bookings.push(base({
      userId: p._id, userName: pname(p), isGuestBooking: false,
      sportSelections: [{ sportId: OID(FOOSBALL_SPORT_ID), sportName: "Foosball", categoryName: "Singles", fee: 0 }],
    }));
  }
  // Doubles — pairs (guest booking named "A / B")
  for (let i = 0; i < DOUBLES_COUNT; i++) {
    const a = players[cur++], b = players[cur++];
    bookings.push(base({
      userId: null, isGuestBooking: true, userName: `${pname(a)} / ${pname(b)}`,
      sportSelections: [{ sportId: OID(FOOSBALL_SPORT_ID), sportName: "Foosball", categoryName: "Doubles", fee: 0 }],
      // partner detail (mirrors team-style guest bookings)
      team: { name: `${pname(a)} / ${pname(b)}`, captain: { name: pname(a), id: String(a._id) }, players: [{ name: pname(b), id: String(b._id) }], teamSize: 2 },
    }));
  }
  await Booking.collection.insertMany(bookings);

  console.log(`\n✅ DONE. ${SINGLES_COUNT} singles + ${DOUBLES_COUNT} doubles pairs seeded.`);
  console.log("   Tournament:", String(tId), "| Sport: Foosball (group + knockout)");
  console.log("   Manage → choose Group stage; pick the Singles or Doubles category to build groups.");
  await mongoose.disconnect();
})().catch((e) => { console.error("SEED ERROR:", e); process.exit(1); });
