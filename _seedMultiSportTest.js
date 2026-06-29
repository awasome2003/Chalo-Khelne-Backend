/**
 * TEST SEED — builds a multi-sport group-stage tournament so the leaderboard
 * can be viewed on mobile across Cricket, Badminton, Table Tennis, Carrom, Chess.
 * Idempotent: deletes any prior tournament with the same title first.
 * Run from server dir:  node _seedMultiSportTest.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const OID = (s) => new mongoose.Types.ObjectId(s);
const newId = () => new mongoose.Types.ObjectId();

const MGR_ID = "6838358b4f831ea6854c479e";
const CLUB_ID = "67dd59de71d08e6633cd3531";
const TITLE = "🏆 MULTI-SPORT TEST — Cricket/Badminton/TT/Carrom/Chess";

const SPORTS = [
  { name: "Cricket",      sportId: "69b7ce0cf50e303a19ed6119", slug: "cricket",      scoringType: "innings",
    mf: { scoringType: "innings", oversCount: 20, inningsCount: 2, superOver: true, totalSets: 2, setsToWin: 1, formatVersion: 1 } },
  { name: "Badminton",    sportId: "69b7ce0cf50e303a19ed610d", slug: "badminton",    scoringType: "sets",
    mf: { scoringType: "sets", totalSets: 3, setsToWin: 2, totalGames: 3, gamesToWin: 2, pointsToWinGame: 21, marginToWin: 2, deuceRule: true, maxPointsCap: 30, formatVersion: 1 } },
  { name: "Table Tennis", sportId: "69b7ce0cf50e303a19ed6110", slug: "table-tennis", scoringType: "sets",
    mf: { scoringType: "sets", totalSets: 3, setsToWin: 2, totalGames: 3, gamesToWin: 2, pointsToWinGame: 11, marginToWin: 2, deuceRule: true, formatVersion: 1 } },
  { name: "Carrom",       sportId: "69b7ce0cf50e303a19ed612e", slug: "carrom",       scoringType: "board",
    mf: { scoringType: "board", boardsToWin: 2, pointsPerBoard: 25, queenValue: 3, totalSets: 3, setsToWin: 2, formatVersion: 1 } },
  { name: "Chess",        sportId: "69b7ce0cf50e303a19ed612b", slug: "chess",        scoringType: "single",
    mf: { scoringType: "single", totalSets: 1, setsToWin: 1, formatVersion: 1 } },
];

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const Tournament = require("./src/modules/tournaments/models/Tournament");
  const BookingGroup = require("./src/modules/tournaments/models/bookinggroup");
  const Match = require("./src/modules/tournaments/models/Tournnamentmatch");
  const GroupStandings = require("./src/modules/tournaments/models/GroupStandings");
  const User = require("./src/modules/identity/models/User");
  const { recalculateGroupStandings } = require("./controllers/groupStageScoreboardController");

  // ── cleanup prior runs ──
  const prior = await Tournament.find({ title: TITLE }).select("_id").lean();
  for (const p of prior) {
    const groups = await BookingGroup.find({ tournamentId: p._id }).select("_id").lean();
    const gids = groups.map((g) => g._id);
    await Match.deleteMany({ tournamentId: p._id });
    await GroupStandings.deleteMany({ tournamentId: p._id });
    await BookingGroup.deleteMany({ tournamentId: p._id });
    await Tournament.deleteOne({ _id: p._id });
    console.log("Removed prior test tournament", String(p._id), "and", gids.length, "groups");
  }

  // ── players (reuse 16 real players, cycle 4 per sport) ──
  const players = await User.find({ role: "Player" }).select("_id name userName").limit(16).lean();
  if (players.length < 4) throw new Error("Not enough players in DB");
  const pname = (p) => (p.name || p.userName || "Player").trim();

  // ── tournament ──
  const tId = newId();
  const sportsTracks = SPORTS.map((s) => ({
    _id: newId(), sportId: OID(s.sportId), sportName: s.name, sportSlug: s.slug,
    type: "group stage",
    categories: [{ _id: newId(), templateId: null, name: "Open", fee: 0, minAge: null, maxAge: null, gender: "any" }],
    groupStageFormat: "Singles", knockoutFormat: null, davisCupFormatId: null,
    qualifyPerGroup: 2, drawSize: null, tournamentLevel: "unranked",
    matchFormat: s.mf, sportRules: null, currentStage: "group_stage",
    stageConfig: { qualifierKnockout: { enabled: false, completed: false }, mainKnockout: { enabled: false, completed: false }, groupStage: { completed: false }, round2Format: null },
    createdAt: new Date(), updatedAt: new Date(),
  }));

  await Tournament.collection.insertOne({
    _id: tId, title: TITLE, tournamentLevel: "unranked",
    description: "Auto-seeded multi-sport test for leaderboard QA.",
    selectedTime: { startTime: "10:00", endTime: "18:00" },
    startDate: "2026-06-20", endDate: "2026-06-30",
    organizerName: "QA Seed", cancellationPolicy: "", eventLocation: ["Test Arena"],
    managerId: [OID(MGR_ID)], sports: sportsTracks,
    registrationDeadline: null, isPrivate: false, courts: [],
    clubId: OID(CLUB_ID), createdAt: new Date(), updatedAt: new Date(), __v: 0,
  });
  console.log("\nCreated tournament", String(tId), "\n");

  // ── helpers to build sport-correct completed matches ──
  let matchSeq = 0;
  const baseMatch = (groupId, sportId, sportName, scoringType, mf, p1, p2) => ({
    _id: newId(), tournamentId: tId, groupId, matchNumber: `M${++matchSeq}`, matchType: "singles",
    player1: { playerId: p1._id, userName: pname(p1), partner: { playerId: null, userName: null } },
    player2: { playerId: p2._id, userName: pname(p2), partner: { playerId: null, userName: null } },
    courtNumber: "1", startTime: new Date(), matchEndTime: new Date(),
    matchFormat: mf, status: "COMPLETED", currentSet: 1, currentGame: 1,
    liveScore: { player1Points: 0, player2Points: 0 }, sets: [],
    sportName, sportId: OID(sportId), scoringType, clubId: OID(CLUB_ID),
    createdAt: new Date(), updatedAt: new Date(), __v: 0,
  });
  const winnerObj = (m, side) => ({ playerId: m[side].playerId, playerName: m[side].userName });

  // Team-vs-team base match (Cricket). Each "side" is a team: playerId/userName
  // carry the TEAM identity (so standings group by team), and teamId+squad carry
  // the team detail — using the player1.teamId/squad fields added to the Match model.
  const baseMatchTeam = (groupId, sportId, sportName, scoringType, mf, tA, tB) => ({
    _id: newId(), tournamentId: tId, groupId, matchNumber: `M${++matchSeq}`, matchType: "singles",
    player1: { playerId: tA._id, userName: tA.name, partner: { playerId: null, userName: null }, teamId: tA._id, squad: tA.squad },
    player2: { playerId: tB._id, userName: tB.name, partner: { playerId: null, userName: null }, teamId: tB._id, squad: tB.squad },
    courtNumber: "1", startTime: new Date(), matchEndTime: new Date(),
    matchFormat: mf, status: "COMPLETED", currentSet: 1, currentGame: 1,
    liveScore: { player1Points: 0, player2Points: 0 }, sets: [],
    sportName, sportId: OID(sportId), scoringType, clubId: OID(CLUB_ID),
    createdAt: new Date(), updatedAt: new Date(), __v: 0,
  });

  function buildCricket(m, r1, w1, r2, w2) {
    const w = r1 >= r2 ? "player1" : "player2"; const win = winnerObj(m, w);
    const innings = [
      { inningsNumber: 1, battingSide: "player1", runs: r1, wickets: w1, oversBowled: 20, ballsBowled: 0, target: null, status: "COMPLETED" },
      { inningsNumber: 2, battingSide: "player2", runs: r2, wickets: w2, oversBowled: 20, ballsBowled: 0, target: r1 + 1, status: "COMPLETED" },
    ];
    const margin = w === "player2" ? { marginType: "wickets", marginValue: 10 - w2 } : { marginType: "runs", marginValue: r1 - r2 };
    m.result = { winner: win, finalScore: { player1Sets: w === "player1" ? 1 : 0, player2Sets: w === "player2" ? 1 : 0 }, innings, cricketResult: { ...margin, isTie: false }, completedAt: new Date(), matchDuration: 200 };
    m.matchResult = { type: "innings", completed: true, player1Score: w === "player1" ? 1 : 0, player2Score: w === "player2" ? 1 : 0, winner: win,
      details: innings.map((i) => ({ inningsNumber: i.inningsNumber, battingSide: i.battingSide, runs: i.runs, wickets: i.wickets, overs: `${i.oversBowled}.${i.ballsBowled}`, target: i.target })) };
    return m;
  }
  function buildSets(m, setScores /* [[p1,p2],...] */) {
    let p1Sets = 0, p2Sets = 0; const sets = [];
    setScores.forEach(([a, b], i) => {
      const sw = a > b ? "player1" : "player2"; if (a > b) p1Sets++; else p2Sets++;
      sets.push({ setNumber: i + 1, status: "COMPLETED", winner: winnerObj(m, sw), games: [{ gameNumber: 1, status: "COMPLETED", finalScore: { player1: a, player2: b }, winner: winnerObj(m, sw) }] });
    });
    const w = p1Sets > p2Sets ? "player1" : "player2"; const win = winnerObj(m, w);
    m.sets = sets;
    m.result = { winner: win, finalScore: { player1Sets: p1Sets, player2Sets: p2Sets }, completedAt: new Date(), matchDuration: 45 };
    m.matchResult = { type: "sets", completed: true, player1Score: p1Sets, player2Score: p2Sets, winner: win,
      details: sets.map((s) => ({ roundNumber: s.setNumber, winner: s.winner, subRounds: [{ number: 1, player1Score: s.games[0].finalScore.player1, player2Score: s.games[0].finalScore.player2 }] })) };
    return m;
  }
  function buildBoard(m, boards /* [["player1",pts,queen],...] */) {
    let p1B = 0, p2B = 0; const arr = [];
    boards.forEach(([wside, pts, queen], i) => {
      if (wside === "player1") p1B++; else p2B++;
      arr.push({ boardNumber: i + 1, player1Points: wside === "player1" ? pts : 0, player2Points: wside === "player2" ? pts : 0, queenPocketedBy: queen ? wside : null, winner: wside, status: "COMPLETED" });
    });
    const w = p1B > p2B ? "player1" : "player2"; const win = winnerObj(m, w);
    m.result = { winner: win, finalScore: { player1Sets: p1B, player2Sets: p2B }, boards: arr, completedAt: new Date(), matchDuration: 30 };
    m.matchResult = { type: "board", completed: true, player1Score: p1B, player2Score: p2B, winner: win,
      details: arr.map((b) => ({ boardNumber: b.boardNumber, player1Score: b.player1Points, player2Score: b.player2Points, winner: b.winner, queenPocketedBy: b.queenPocketedBy })) };
    return m;
  }
  function buildSingle(m, outcome /* "p1" | "p2" | "draw" */) {
    const win = outcome === "draw" ? { playerId: null, playerName: null } : winnerObj(m, outcome === "p1" ? "player1" : "player2");
    const p1s = outcome === "p1" ? 1 : 0, p2s = outcome === "p2" ? 1 : 0;
    m.result = { winner: outcome === "draw" ? { playerId: null, playerName: null } : win, finalScore: { player1Sets: p1s, player2Sets: p2s }, completedAt: new Date(), matchDuration: 60 };
    m.matchResult = { type: "single", completed: true, player1Score: p1s, player2Score: p2s, winner: outcome === "draw" ? null : win, details: [] };
    return m;
  }

  const pairs = [[0, 1], [2, 3], [0, 2]]; // partial round-robin

  // ── per sport: 1 group + 3 completed round-robin matches ──
  for (let si = 0; si < SPORTS.length; si++) {
    const s = SPORTS[si];
    const groupId = newId();
    const matches = [];

    // ── CRICKET: TEAM round-robin (IPL-style) — entrants are TEAMS w/ squads ──
    if (s.name === "Cricket") {
      const teamNames = ["Royal Strikers", "Thunder Kings", "Phoenix XI", "Titan Warriors"];
      const teams = teamNames.map((name, ti) => ({
        _id: newId(), name,
        squad: [0, 1, 2, 3].map((k) => players[(ti * 4 + k) % players.length]).map((p, bi) => ({ userId: p._id, name: pname(p), battingOrder: bi + 1 })),
      }));
      await BookingGroup.collection.insertOne({
        _id: groupId, tournamentId: tId, groupName: "Group A", category: "open",
        players: teams.map((t) => ({ _id: newId(), playerId: t._id, userName: t.name, bookingDate: null, joinedAt: new Date() })),
        matchFormat: s.mf, round: 1, roundType: "league", sportId: OID(s.sportId), createdAt: new Date(), __v: 0,
      });
      pairs.forEach(([a, b], idx) => {
        const m = baseMatchTeam(groupId, s.sportId, s.name, s.scoringType, s.mf, teams[a], teams[b]);
        buildCricket(m, 150 + idx * 8, 6, 140 + idx * 5, 8);
        matches.push(m);
      });
      await Match.collection.insertMany(matches);
      await recalculateGroupStandings(tId, groupId);
      console.log(`✓ ${s.name.padEnd(13)} — TEAM round-robin: ${teams.length} teams (squads) + ${matches.length} matches + standings`);
      continue;
    }

    // ── OTHER SPORTS: individual-player round-robin (unchanged) ──
    const four = [0, 1, 2, 3].map((k) => players[(si * 2 + k) % players.length]);
    await BookingGroup.collection.insertOne({
      _id: groupId, tournamentId: tId, groupName: "Group A", category: "open",
      players: four.map((p) => ({ _id: newId(), playerId: p._id, userName: pname(p), bookingDate: null, joinedAt: new Date() })),
      matchFormat: s.mf, round: 1, roundType: "league", sportId: OID(s.sportId), createdAt: new Date(), __v: 0,
    });
    pairs.forEach(([a, b], idx) => {
      const m = baseMatch(groupId, s.sportId, s.name, s.scoringType, s.mf, four[a], four[b]);
      if (s.name === "Carrom") buildBoard(m, idx === 0 ? [["player1", 11, true], ["player2", 8, false], ["player1", 6, false]] : [["player1", 9, false], ["player1", 12, true]]);
      else if (s.name === "Chess") buildSingle(m, idx === 1 ? "draw" : (idx === 0 ? "p1" : "p2"));
      else buildSets(m, idx === 0 ? [[21, 18], [19, 21], [21, 16]] : [[21, 15], [21, 17]]); // sets
      matches.push(m);
    });
    await Match.collection.insertMany(matches);
    await recalculateGroupStandings(tId, groupId);
    console.log(`✓ ${s.name.padEnd(13)} — group + ${matches.length} matches + standings (scoringType=${s.scoringType})`);
  }

  console.log("\n✅ DONE. Open tournament", String(tId), "on mobile (manager: Akash Kamble). Title:", TITLE);
  await mongoose.disconnect();
})().catch((e) => { console.error("SEED ERROR:", e); process.exit(1); });
