/**
 * Seed GROUPS + COMPLETED matches into the existing multi-sport tournament
 * 6a3a17250f55b4daf886f967 so the mobile leaderboard shows real, sport-correct
 * results for every sport. Uses the tournament's OWN registrants (so standings
 * line up). Cricket = 4 TEAMS (innings); other sports = 4 players each.
 * Foosball is left alone (already played). Idempotent per sport.
 * Run from server dir:  node _seedPlayIntoTournament.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const OID = (s) => new mongoose.Types.ObjectId(s);
const newId = () => new mongoose.Types.ObjectId();

const T_ID = "6a3a17250f55b4daf886f967";
const CLUB_ID = "67dd59de71d08e6633cd3531";

const SPORTS = [
  { name: "Cricket", sportId: "69b7ce0cf50e303a19ed6119", scoringType: "innings", isTeam: true,
    mf: { scoringType: "innings", oversCount: 20, inningsCount: 2, superOver: true, totalSets: 2, setsToWin: 1, formatVersion: 1 } },
  { name: "Badminton", sportId: "69b7ce0cf50e303a19ed610d", scoringType: "sets",
    mf: { scoringType: "sets", totalSets: 3, setsToWin: 2, totalGames: 3, gamesToWin: 2, pointsToWinGame: 21, marginToWin: 2, deuceRule: true, maxPointsCap: 30, formatVersion: 1 } },
  { name: "Table Tennis", sportId: "69b7ce0cf50e303a19ed6110", scoringType: "sets",
    mf: { scoringType: "sets", totalSets: 3, setsToWin: 2, totalGames: 3, gamesToWin: 2, pointsToWinGame: 11, marginToWin: 2, deuceRule: true, formatVersion: 1 } },
  { name: "Carrom", sportId: "69b7ce0cf50e303a19ed612e", scoringType: "board",
    mf: { scoringType: "board", boardsToWin: 2, pointsPerBoard: 25, queenValue: 3, totalSets: 3, setsToWin: 2, formatVersion: 1 } },
  { name: "Chess", sportId: "69b7ce0cf50e303a19ed612b", scoringType: "single",
    mf: { scoringType: "single", totalSets: 1, setsToWin: 1, formatVersion: 1 } },
];

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  // Register Tournament FIRST — it defines the "Score" model; loading it before
  // Match/BookingGroup avoids the OverwriteModelError during recalc.
  require("./src/modules/tournaments/models/Tournament");
  const BookingGroup = require("./src/modules/tournaments/models/bookinggroup");
  const Match = require("./src/modules/tournaments/models/Tournnamentmatch");
  const GroupStandings = require("./src/modules/tournaments/models/GroupStandings");
  const Booking = require("./src/modules/tournaments/models/BookingModel");
  const User = require("./src/modules/identity/models/User");
  const { recalculateGroupStandings } = require("./controllers/groupStageScoreboardController");

  const tId = OID(T_ID);
  const pname = (p) => (p.name || p.userName || "Player").trim();
  let matchSeq = Date.now() % 100000;

  const baseMatch = (groupId, s, p1, p2) => ({
    _id: newId(), tournamentId: tId, groupId, matchNumber: `M${++matchSeq}`, matchType: "singles",
    player1: { playerId: p1._id, userName: p1.name, partner: { playerId: null, userName: null } },
    player2: { playerId: p2._id, userName: p2.name, partner: { playerId: null, userName: null } },
    courtNumber: "1", startTime: new Date(), matchEndTime: new Date(),
    matchFormat: s.mf, status: "COMPLETED", currentSet: 1, currentGame: 1,
    liveScore: { player1Points: 0, player2Points: 0 }, sets: [],
    sportName: s.name, sportId: OID(s.sportId), scoringType: s.scoringType, clubId: OID(CLUB_ID),
    createdAt: new Date(), updatedAt: new Date(), __v: 0,
  });
  const baseMatchTeam = (groupId, s, tA, tB) => ({
    _id: newId(), tournamentId: tId, groupId, matchNumber: `M${++matchSeq}`, matchType: "singles",
    player1: { playerId: tA._id, userName: tA.name, partner: { playerId: null, userName: null }, teamId: tA._id, squad: tA.squad },
    player2: { playerId: tB._id, userName: tB.name, partner: { playerId: null, userName: null }, teamId: tB._id, squad: tB.squad },
    courtNumber: "1", startTime: new Date(), matchEndTime: new Date(),
    matchFormat: s.mf, status: "COMPLETED", currentSet: 1, currentGame: 1,
    liveScore: { player1Points: 0, player2Points: 0 }, sets: [],
    sportName: s.name, sportId: OID(s.sportId), scoringType: s.scoringType, clubId: OID(CLUB_ID),
    createdAt: new Date(), updatedAt: new Date(), __v: 0,
  });
  const winnerObj = (m, side) => ({ playerId: m[side].playerId, playerName: m[side].userName });

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
  function buildSets(m, setScores) {
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
  function buildBoard(m, boards) {
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
  function buildSingle(m, outcome) {
    const win = outcome === "draw" ? { playerId: null, playerName: null } : winnerObj(m, outcome === "p1" ? "player1" : "player2");
    const p1s = outcome === "p1" ? 1 : 0, p2s = outcome === "p2" ? 1 : 0;
    m.result = { winner: win, finalScore: { player1Sets: p1s, player2Sets: p2s }, completedAt: new Date(), matchDuration: 60 };
    m.matchResult = { type: "single", completed: true, player1Score: p1s, player2Score: p2s, winner: outcome === "draw" ? null : win, details: [] };
    return m;
  }

  const pairs = [[0, 1], [2, 3], [0, 2]]; // partial round-robin (3 matches)

  for (const s of SPORTS) {
    // ── clean prior groups/matches/standings for THIS sport ──
    const prior = await BookingGroup.find({ tournamentId: tId, sportId: OID(s.sportId) }).select("_id").lean();
    const gids = prior.map((g) => g._id);
    await Match.deleteMany({ tournamentId: tId, sportId: OID(s.sportId) });
    if (gids.length) await GroupStandings.deleteMany({ tournamentId: tId, groupId: { $in: gids } });
    await BookingGroup.deleteMany({ tournamentId: tId, sportId: OID(s.sportId) });

    const groupId = newId();
    const matches = [];

    if (s.isTeam) {
      // ── Cricket: 4 TEAMS from the tournament's team bookings ──
      const teamBookings = await Booking.find({ tournamentId: tId, "team.name": { $exists: true }, "sportSelections.sportName": "Cricket", status: "confirmed" }).limit(4).lean();
      if (teamBookings.length < 2) { console.log(`✗ ${s.name}: not enough team bookings (${teamBookings.length}) — skipped`); continue; }
      const teams = teamBookings.map((b) => ({
        _id: newId(), name: b.team.name,
        squad: (b.team.roster || b.team.players || []).slice(0, 4).map((p, i) => ({ userId: p.userId || p.id || null, name: p.name, battingOrder: i + 1 })),
      }));
      await BookingGroup.collection.insertOne({
        _id: groupId, tournamentId: tId, groupName: "Group A", category: "open",
        players: teams.map((t) => ({ _id: newId(), playerId: t._id, userName: t.name, bookingDate: null, joinedAt: new Date() })),
        matchFormat: s.mf, round: 1, roundType: "league", sportId: OID(s.sportId), createdAt: new Date(), __v: 0,
      });
      pairs.forEach(([a, b], idx) => {
        if (!teams[a] || !teams[b]) return;
        const m = baseMatchTeam(groupId, s, teams[a], teams[b]);
        buildCricket(m, 150 + idx * 8, 6, 140 + idx * 5, 8);
        matches.push(m);
      });
    } else {
      // ── Individual sports: 4 registered players for this sport ──
      const bookings = await Booking.find({ tournamentId: tId, userId: { $ne: null }, "sportSelections.sportName": s.name, status: "confirmed" }).limit(4).lean();
      if (bookings.length < 2) { console.log(`✗ ${s.name}: not enough player bookings (${bookings.length}) — skipped`); continue; }
      const four = bookings.map((b) => ({ _id: b.userId, name: b.userName }));
      await BookingGroup.collection.insertOne({
        _id: groupId, tournamentId: tId, groupName: "Group A", category: "open",
        players: four.map((p) => ({ _id: newId(), playerId: p._id, userName: p.name, bookingDate: null, joinedAt: new Date() })),
        matchFormat: s.mf, round: 1, roundType: "league", sportId: OID(s.sportId), createdAt: new Date(), __v: 0,
      });
      pairs.forEach(([a, b], idx) => {
        if (!four[a] || !four[b]) return;
        const m = baseMatch(groupId, s, four[a], four[b]);
        if (s.name === "Carrom") buildBoard(m, idx === 0 ? [["player1", 11, true], ["player2", 8, false], ["player1", 6, false]] : [["player1", 9, false], ["player1", 12, true]]);
        else if (s.name === "Chess") buildSingle(m, idx === 1 ? "draw" : (idx === 0 ? "p1" : "p2"));
        else buildSets(m, idx === 0 ? [[21, 18], [19, 21], [21, 16]] : [[21, 15], [21, 17]]);
        matches.push(m);
      });
    }

    if (matches.length === 0) { console.log(`✗ ${s.name}: no matches built — skipped`); continue; }
    await Match.collection.insertMany(matches);
    await recalculateGroupStandings(tId, groupId);
    console.log(`✓ ${s.name.padEnd(13)} — Group A + ${matches.length} completed matches + standings (${s.scoringType})`);
  }

  console.log("\n✅ DONE. Open the tournament on mobile — each sport now shows played results.");
  await mongoose.disconnect();
})().catch((e) => { console.error("SEED ERROR:", e); process.exit(1); });
