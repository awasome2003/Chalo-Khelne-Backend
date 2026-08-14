"use strict";
/**
 * Swiss events end-to-end, through the real route stack.
 *
 * The pairing algorithm is proven in tests/unit/swissPairing.test.js. What is
 * proven here is the part that touches the database: that pairing state is
 * correctly REBUILT from stored matches each round, that the round lifecycle
 * cannot be short-circuited, and that a corrected result changes the pairings
 * that follow it.
 */
const request = require("supertest");
const {
  startTestApp, stopTestApp, superAdminToken, clearDatabase,
} = require("./setup");

const Tournament = require("../../src/modules/tournaments/models/Tournament");
const Sport = require("../../src/modules/catalog/models/Sport");
const SwissMatch = require("../../src/modules/tournaments/models/SwissMatch");

let app;
let token;

beforeAll(async () => { app = await startTestApp(); });
afterAll(stopTestApp);
beforeEach(async () => { await clearDatabase(); token = superAdminToken(); });

const names = (n) => Array.from({ length: n }, (_, i) => `P${i + 1}`);
const players = (n) => names(n).map((nm, i) => ({ userName: nm, seed: i + 1 }));

async function seedTournament() {
  const sport = await Sport.create({ name: "Badminton", category: "Racquet", scoringType: "sets" });
  const t = await Tournament.create({
    title: "Swiss Cup",
    sports: [{
      sportId: sport._id, sportName: "Badminton", tournamentLevel: "unranked",
      type: "swiss",
      categories: [{ name: "Open", fee: 0 }],
      matchFormat: { scoringType: "sets", totalSets: 3, setsToWin: 2, pointsPerSet: 21 },
    }],
  });
  return { tournamentId: String(t._id), sportId: String(sport._id) };
}

const start = (tournamentId, body) =>
  request(app).post(`/api/tournaments/swiss/${tournamentId}/start`)
    .set("Authorization", `Bearer ${token}`).send(body);

const nextRound = (tournamentId, body = {}) =>
  request(app).post(`/api/tournaments/swiss/${tournamentId}/next-round`)
    .set("Authorization", `Bearer ${token}`).send(body);

const getEvent = (tournamentId, sportId, category = "Open") =>
  request(app).get(`/api/tournaments/swiss/${tournamentId}?sportId=${sportId}&category=${encodeURIComponent(category)}`)
    .set("Authorization", `Bearer ${token}`);

/**
 * Decide every unplayed match of the current round. `winnerPicker` receives the
 * match and returns "player1" | "player2" | "draw".
 */
async function playRound(tournamentId, round, winnerPicker = () => "player1") {
  const inRound = await SwissMatch.find({ tournamentId, swissRound: round, isBye: false });
  for (const m of inRound) {
    const choice = winnerPicker(m);
    const isDraw = choice === "draw";
    const winner = choice === "player2" ? m.player2 : m.player1;
    m.status = "COMPLETED";
    m.result = {
      winner: isDraw
        ? { playerId: null, playerName: null }
        : { playerId: winner.playerId || null, playerName: winner.userName },
      finalScore: { player1Sets: isDraw ? 1 : (choice === "player1" ? 2 : 0), player2Sets: isDraw ? 1 : (choice === "player1" ? 0 : 2) },
      isDraw,
      completedAt: new Date(),
    };
    await m.save({ validateModifiedOnly: true });
  }
}

describe("starting an event", () => {
  test("generates round 1 and pairs top half against bottom half", async () => {
    const { tournamentId, sportId } = await seedTournament();
    const res = await start(tournamentId, {
      sportId, category: "Open", players: players(8), rounds: 3,
    });

    expect(res.status).toBe(201);
    expect(res.body.round).toBe(1);
    expect(res.body.totalRounds).toBe(3);

    const r1 = await SwissMatch.find({ tournamentId, swissRound: 1 }).sort({ matchNumber: 1 });
    expect(r1).toHaveLength(4);
    expect(r1.map((m) => [m.player1.userName, m.player2.userName])).toEqual([
      ["P1", "P5"], ["P2", "P6"], ["P3", "P7"], ["P4", "P8"],
    ]);
    // Every match carries the event's round count, so the event is
    // self-describing without a separate config document.
    expect(r1.every((m) => m.totalRounds === 3)).toBe(true);
  });

  test("an odd field gets a bye, already completed", async () => {
    const { tournamentId, sportId } = await seedTournament();
    await start(tournamentId, { sportId, category: "Open", players: players(7), rounds: 3 });

    const r1 = await SwissMatch.find({ tournamentId, swissRound: 1 });
    expect(r1).toHaveLength(4); // 3 matches + 1 bye
    const bye = r1.find((m) => m.isBye);
    expect(bye).toBeTruthy();
    expect(bye.status).toBe("COMPLETED");
    expect(bye.player1.userName).toBe("P7"); // lowest ranked
    expect(bye.result.winner.playerName).toBe("P7");
  });

  test("rejects a round count the field cannot support", async () => {
    const { tournamentId, sportId } = await seedTournament();
    // 4 players support at most 3 rounds without a repeat.
    const res = await start(tournamentId, {
      sportId, category: "Open", players: players(4), rounds: 5,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at most 3 rounds/i);
    expect(res.body.maxRounds).toBe(3);
    expect(await SwissMatch.countDocuments({ tournamentId })).toBe(0);
  });

  test("rejects duplicate entrants", async () => {
    const { tournamentId, sportId } = await seedTournament();
    const res = await start(tournamentId, {
      sportId, category: "Open",
      players: [{ userName: "P1" }, { userName: "P2" }, { userName: "P1" }],
      rounds: 2,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/duplicate/i);
  });

  test("rejects a second event for the same sport and category", async () => {
    const { tournamentId, sportId } = await seedTournament();
    await start(tournamentId, { sportId, category: "Open", players: players(8), rounds: 3 });
    const res = await start(tournamentId, { sportId, category: "Open", players: players(8), rounds: 3 });
    expect(res.status).toBe(409);
  });

  test("requires at least 2 players", async () => {
    const { tournamentId, sportId } = await seedTournament();
    const res = await start(tournamentId, { sportId, category: "Open", players: players(1), rounds: 1 });
    expect(res.status).toBe(400);
  });
});

describe("round lifecycle", () => {
  test("refuses the next round while the current one is unfinished", async () => {
    const { tournamentId, sportId } = await seedTournament();
    await start(tournamentId, { sportId, category: "Open", players: players(8), rounds: 3 });

    const res = await nextRound(tournamentId, { sportId, category: "Open" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/still to be played/i);
    expect(res.body.pending).toHaveLength(4);
    expect(await SwissMatch.countDocuments({ tournamentId, swissRound: 2 })).toBe(0);
  });

  test("generates the next round once every result is in", async () => {
    const { tournamentId, sportId } = await seedTournament();
    await start(tournamentId, { sportId, category: "Open", players: players(8), rounds: 3 });
    await playRound(tournamentId, 1);

    const res = await nextRound(tournamentId, { sportId, category: "Open" });
    expect(res.status).toBe(201);
    expect(res.body.round).toBe(2);
    expect(await SwissMatch.countDocuments({ tournamentId, swissRound: 2 })).toBe(4);
  });

  test("pairs winners with winners in round 2", async () => {
    const { tournamentId, sportId } = await seedTournament();
    await start(tournamentId, { sportId, category: "Open", players: players(8), rounds: 3 });
    await playRound(tournamentId, 1); // player1 wins each → P1..P4 on 1, P5..P8 on 0
    await nextRound(tournamentId, { sportId, category: "Open" });

    const r2 = await SwissMatch.find({ tournamentId, swissRound: 2, isBye: false });
    const winners = new Set(["P1", "P2", "P3", "P4"]);
    for (const m of r2) {
      const bothWon = winners.has(m.player1.userName) && winners.has(m.player2.userName);
      const bothLost = !winners.has(m.player1.userName) && !winners.has(m.player2.userName);
      expect(bothWon || bothLost).toBe(true);
    }
  });

  test("never repeats a pairing across a full event", async () => {
    const { tournamentId, sportId } = await seedTournament();
    await start(tournamentId, { sportId, category: "Open", players: players(8), rounds: 3 });

    for (let round = 1; round <= 3; round++) {
      await playRound(tournamentId, round);
      if (round < 3) {
        const res = await nextRound(tournamentId, { sportId, category: "Open" });
        expect(res.status).toBe(201);
      }
    }

    const all = await SwissMatch.find({ tournamentId, isBye: false });
    expect(all).toHaveLength(12); // 3 rounds x 4
    const keys = all.map((m) => [m.player1.userName, m.player2.userName].sort().join("|"));
    expect(new Set(keys).size).toBe(12);
  });

  test("refuses to generate past the configured round count", async () => {
    const { tournamentId, sportId } = await seedTournament();
    await start(tournamentId, { sportId, category: "Open", players: players(8), rounds: 2 });
    await playRound(tournamentId, 1);
    await nextRound(tournamentId, { sportId, category: "Open" });
    await playRound(tournamentId, 2);

    const res = await nextRound(tournamentId, { sportId, category: "Open" });
    expect(res.status).toBe(400);
    expect(res.body.complete).toBe(true);
  });

  test("404s when no event exists", async () => {
    const { tournamentId, sportId } = await seedTournament();
    const res = await nextRound(tournamentId, { sportId, category: "Open" });
    expect(res.status).toBe(404);
  });
});

describe("standings", () => {
  test("scores wins, draws and byes, and ranks by score", async () => {
    const { tournamentId, sportId } = await seedTournament();
    await start(tournamentId, { sportId, category: "Open", players: players(4), rounds: 2 });
    // P1 beats P3, P2 draws P4.
    await playRound(tournamentId, 1, (m) => (m.player1.userName === "P2" ? "draw" : "player1"));

    const res = await getEvent(tournamentId, sportId);
    expect(res.status).toBe(200);
    const rows = Object.fromEntries(res.body.standings.map((r) => [r.name, r]));

    expect(rows.P1.score).toBe(1);
    expect(rows.P1.won).toBe(1);
    expect(rows.P3.score).toBe(0);
    expect(rows.P3.lost).toBe(1);
    expect(rows.P2.score).toBe(0.5);
    expect(rows.P2.drawn).toBe(1);
    expect(rows.P4.score).toBe(0.5);

    expect(res.body.standings[0].name).toBe("P1");
    expect(res.body.standings[0].rank).toBe(1);
  });

  test("a bye scores a point but does not count as a match played", async () => {
    const { tournamentId, sportId } = await seedTournament();
    await start(tournamentId, { sportId, category: "Open", players: players(5), rounds: 2 });

    const res = await getEvent(tournamentId, sportId);
    const p5 = res.body.standings.find((r) => r.name === "P5");
    expect(p5.score).toBe(1);
    expect(p5.byes).toBe(1);
    expect(p5.played).toBe(0);
  });

  test("reports what the manager can do next", async () => {
    const { tournamentId, sportId } = await seedTournament();
    await start(tournamentId, { sportId, category: "Open", players: players(8), rounds: 3 });

    let res = await getEvent(tournamentId, sportId);
    expect(res.body.canGenerateNextRound).toBe(false); // round 1 unplayed
    expect(res.body.currentRound).toBe(1);

    await playRound(tournamentId, 1);
    res = await getEvent(tournamentId, sportId);
    expect(res.body.canGenerateNextRound).toBe(true);
    expect(res.body.rounds[0].complete).toBe(true);
  });

  test("returns exists:false before an event is started", async () => {
    const { tournamentId, sportId } = await seedTournament();
    const res = await getEvent(tournamentId, sportId);
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(false);
  });
});

describe("pairing state is derived, not stored", () => {
  test("correcting a result changes the pairings of the next round", async () => {
    const { tournamentId, sportId } = await seedTournament();
    await start(tournamentId, { sportId, category: "Open", players: players(8), rounds: 3 });
    await playRound(tournamentId, 1);

    // Flip one round-1 result before generating round 2.
    const flip = await SwissMatch.findOne({ tournamentId, swissRound: 1, matchNumber: 1 });
    flip.result = {
      winner: { playerId: null, playerName: flip.player2.userName },
      finalScore: { player1Sets: 0, player2Sets: 2 },
      isDraw: false,
      completedAt: new Date(),
    };
    await flip.save({ validateModifiedOnly: true });

    await nextRound(tournamentId, { sportId, category: "Open" });

    // P5 beat P1, so P5 is now on 1 point and must be paired among the winners.
    const res = await getEvent(tournamentId, sportId);
    const p5 = res.body.standings.find((r) => r.name === "P5");
    const p1 = res.body.standings.find((r) => r.name === "P1");
    expect(p5.score).toBe(1);
    expect(p1.score).toBe(0);

    const r2 = await SwissMatch.find({ tournamentId, swissRound: 2, isBye: false });
    const p5Match = r2.find((m) => [m.player1.userName, m.player2.userName].includes("P5"));
    const opponent = p5Match.player1.userName === "P5" ? p5Match.player2.userName : p5Match.player1.userName;
    // Its opponent must also be on 1 point — never P1, who now has 0.
    expect(opponent).not.toBe("P1");
    expect(res.body.standings.find((r) => r.name === opponent).score).toBe(1);
  });
});

describe("multiple events in one tournament", () => {
  test("categories run independently and reset independently", async () => {
    const sport = await Sport.create({ name: "Badminton", category: "Racquet", scoringType: "sets" });
    const t = await Tournament.create({
      title: "Two Category Cup",
      sports: [{
        sportId: sport._id, sportName: "Badminton", tournamentLevel: "unranked", type: "swiss",
        categories: [{ name: "Open", fee: 0 }, { name: "Above 40", fee: 0 }],
        matchFormat: { scoringType: "sets", totalSets: 3, setsToWin: 2 },
      }],
    });
    const tournamentId = String(t._id);
    const sportId = String(sport._id);

    await start(tournamentId, { sportId, category: "Open", players: players(8), rounds: 3 });
    await start(tournamentId, { sportId, category: "Above 40", players: players(4), rounds: 2 });

    expect(await SwissMatch.countDocuments({ tournamentId, category: "Open" })).toBe(4);
    expect(await SwissMatch.countDocuments({ tournamentId, category: "Above 40" })).toBe(2);

    const del = await request(app)
      .delete(`/api/tournaments/swiss/${tournamentId}?sportId=${sportId}&category=Open`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);

    expect(await SwissMatch.countDocuments({ tournamentId, category: "Open" })).toBe(0);
    expect(await SwissMatch.countDocuments({ tournamentId, category: "Above 40" })).toBe(2);
  });
});
