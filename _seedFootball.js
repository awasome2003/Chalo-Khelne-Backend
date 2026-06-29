/**
 * Add FOOTBALL (team, time-based) to tournament 6a3a17250f55b4daf886f967:
 *   - registers the Football sport on the tournament (if missing)
 *   - creates 4 football teams + Group A
 *   - generates 3 SCHEDULED (unscored) group matches so the manager can
 *     enter scores directly via the football scoreboard
 *   - inits empty standings
 * Idempotent: wipes prior football groups/matches/standings first.
 * Run from server dir:  node _seedFootball.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const OID = (s) => new mongoose.Types.ObjectId(s);
const newId = () => new mongoose.Types.ObjectId();

const T_ID = "6a3a17250f55b4daf886f967";
const CLUB_ID = "67dd59de71d08e6633cd3531";
const FOOTBALL_SPORT_ID = "69b7ce0cf50e303a19ed611c";

const MF = {
  totalGames: 1, gamesToWin: 1, pointsToWinGame: null, marginToWin: null, deuceRule: false,
  maxPointsCap: null, tiebreakEnabled: false, tiebreakPoints: null, decidingSetPoints: null, serviceAlternate: 2,
  halvesCount: 2, halvesDuration: 45, quartersCount: null, quartersDuration: null,
  boardsToWin: null, pointsPerBoard: null, queenValue: null,
  oversCount: null, inningsCount: null, superOver: null,
  scoringType: "time", totalSets: 1, setsToWin: 1, formatVersion: 1,
};

const TEAMS = [
  { name: "Royal FC", squad: ["Rohan", "Arjun", "Kabir", "Manav", "Aman", "Soham"] },
  { name: "Strikers United", squad: ["Vivaan", "Aditya", "Karan", "Reyansh", "Dhruv", "Ayaan"] },
  { name: "Phoenix FC", squad: ["Ishaan", "Dev", "Sohan", "Veer", "Arnav", "Rudra"] },
  { name: "Titan SC", squad: ["Kunal", "Yash", "Neil", "Om", "Shaurya", "Krish"] },
];

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  require("./src/modules/tournaments/models/Tournament");
  const Tournament = mongoose.model("Tournament");
  const BookingGroup = require("./src/modules/tournaments/models/bookinggroup");
  const Match = require("./src/modules/tournaments/models/Tournnamentmatch");
  const GroupStandings = require("./src/modules/tournaments/models/GroupStandings");
  const { recalculateGroupStandings } = require("./controllers/groupStageScoreboardController");

  const tId = OID(T_ID);
  const sId = OID(FOOTBALL_SPORT_ID);

  // ── 1. Register Football on the tournament (if missing) ──
  const tourney = await Tournament.collection.findOne({ _id: tId });
  const hasFootball = (tourney.sports || []).some((s) => String(s.sportId) === FOOTBALL_SPORT_ID);
  if (!hasFootball) {
    const sportEntry = {
      matchFormat: MF, sportRules: null,
      stageConfig: {
        qualifierKnockout: { enabled: false, completed: false },
        mainKnockout: { enabled: false, completed: false },
        groupStage: { completed: false }, round2Format: null,
      },
      _id: newId(), sportId: sId, sportName: "Football", sportSlug: "football",
      type: "group stage",
      categories: [{ _id: newId(), templateId: null, name: "Open", fee: 0, minAge: null, maxAge: null, gender: "any" }],
      groupStageFormat: "Singles", knockoutFormat: null, davisCupFormatId: null,
      qualifyPerGroup: 2, drawSize: null, tournamentLevel: "unranked", currentStage: "group_stage",
      createdAt: new Date(), updatedAt: new Date(),
    };
    await Tournament.collection.updateOne({ _id: tId }, { $push: { sports: sportEntry } });
    console.log("✓ Football sport added to tournament");
  } else {
    console.log("• Football sport already on tournament — leaving as is");
  }

  // ── 1b. Add a football ground court (if missing) ──
  const hasCourt = (tourney.courts || []).some((c) => String(c.sportId) === FOOTBALL_SPORT_ID);
  if (!hasCourt) {
    await Tournament.collection.updateOne({ _id: tId }, {
      $push: { courts: { name: "Football Ground 1", type: "ground", sportId: sId, isActive: true, createdAt: new Date(), _id: newId() } },
    });
    console.log("✓ Football Ground 1 court added");
  }

  // ── 2. Wipe prior football groups/matches/standings ──
  const prior = await BookingGroup.find({ tournamentId: tId, sportId: sId }).select("_id").lean();
  const gids = prior.map((g) => g._id);
  await Match.deleteMany({ tournamentId: tId, sportId: sId });
  if (gids.length) await GroupStandings.deleteMany({ tournamentId: tId, groupId: { $in: gids } });
  await BookingGroup.deleteMany({ tournamentId: tId, sportId: sId });

  // ── 3. Teams + Group A ──
  const teams = TEAMS.map((t) => ({
    _id: newId(), name: t.name,
    squad: t.squad.map((n, i) => ({ userId: null, name: n, battingOrder: i + 1 })),
  }));
  const groupId = newId();
  await BookingGroup.collection.insertOne({
    _id: groupId, tournamentId: tId, groupName: "Group A", category: "open",
    players: teams.map((t) => ({ _id: newId(), playerId: t._id, userName: t.name, bookingDate: null, joinedAt: new Date() })),
    matchFormat: MF, round: 1, roundType: "league", sportId: sId, createdAt: new Date(), __v: 0,
  });

  // ── 4. SCHEDULED (unscored) matches — partial round-robin ──
  let seq = Date.now() % 100000;
  const pairs = [[0, 1], [2, 3], [0, 2]];
  const matches = pairs.map(([a, b]) => ({
    _id: newId(), tournamentId: tId, groupId, matchNumber: `M${++seq}`, matchType: "singles",
    player1: { playerId: teams[a]._id, userName: teams[a].name, partner: { playerId: null, userName: null }, teamId: teams[a]._id, squad: teams[a].squad },
    player2: { playerId: teams[b]._id, userName: teams[b].name, partner: { playerId: null, userName: null }, teamId: teams[b]._id, squad: teams[b].squad },
    courtNumber: "Football Ground 1", startTime: new Date(), matchEndTime: null,
    matchFormat: MF, status: "SCHEDULED", currentSet: 1, currentGame: 1,
    liveScore: { player1Points: 0, player2Points: 0 }, sets: [],
    sportName: "Football", sportId: sId, scoringType: "time", clubId: OID(CLUB_ID),
    result: null, matchResult: null,
    createdAt: new Date(), updatedAt: new Date(), __v: 0,
  }));
  await Match.collection.insertMany(matches);

  // ── 5. Init standings (empty until scored) ──
  await recalculateGroupStandings(tId, groupId);

  console.log(`✓ Football — Group A + ${matches.length} SCHEDULED matches (${teams.map((t) => t.name).join(", ")})`);
  console.log("\n✅ DONE. Open the tournament → Football → Group A and enter scores on the football board.");
  await mongoose.disconnect();
})().catch((e) => { console.error("SEED ERROR:", e); process.exit(1); });
