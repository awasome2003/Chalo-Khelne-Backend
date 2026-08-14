"use strict";
/**
 * Swiss matches score through the EXISTING engines.
 *
 * Swiss deliberately does not get its own scoring code. Writing a second
 * implementation is what let the bulk-upload and live-scoring paths drift apart
 * for direct knockout — the same match ended up stored two different ways
 * depending on how it was scored. Swiss reuses the shared engines instead, and
 * is reached by being registered in the model lookup chains as the LAST
 * fallback, so every existing match type still resolves exactly as before.
 *
 * These tests prove the reuse actually works end to end, rather than assuming
 * registration was enough.
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

const players = (n) =>
  Array.from({ length: n }, (_, i) => ({ userName: `P${i + 1}`, seed: i + 1 }));

async function startEvent(playerCount = 8, rounds = 3) {
  const sport = await Sport.create({ name: "Badminton", category: "Racquet", scoringType: "sets" });
  const t = await Tournament.create({
    title: "Swiss Scoring Cup",
    sports: [{
      sportId: sport._id, sportName: "Badminton", tournamentLevel: "unranked", type: "swiss",
      categories: [{ name: "Open", fee: 0 }],
      matchFormat: { scoringType: "sets", totalSets: 3, setsToWin: 2, pointsPerSet: 21 },
    }],
  });
  const tournamentId = String(t._id);
  const res = await request(app)
    .post(`/api/tournaments/swiss/${tournamentId}/start`)
    .set("Authorization", `Bearer ${token}`)
    .send({ sportId: String(sport._id), category: "Open", players: players(playerCount), rounds });
  expect(res.status).toBe(201);
  return { tournamentId, sportId: String(sport._id) };
}

describe("the shared bulk-upload engine scores Swiss matches", () => {
  test("a best-of-3 result is recorded and the winner is correct", async () => {
    const { tournamentId } = await startEvent();
    const m = await SwissMatch.findOne({ tournamentId, swissRound: 1, matchNumber: 1 });

    const res = await request(app)
      .post("/api/tournaments/matches/bulk-upload-scores")
      .set("Authorization", `Bearer ${token}`)
      .send({
        tournamentId,
        scores: [{
          matchId: String(m._id),
          sets: [{ player1Score: 21, player2Score: 15 }, { player1Score: 21, player2Score: 18 }],
        }],
      });

    expect(res.status).toBe(200);
    expect(res.body.errors || []).toHaveLength(0);

    const after = await SwissMatch.findById(m._id).lean();
    expect(after.status).toBe("COMPLETED");
    expect(after.result.winner.playerName).toBe(m.player1.userName);
    expect(after.sets.length).toBeGreaterThan(0);
  });

  test("the incomplete-score guard applies to Swiss too", async () => {
    const { tournamentId } = await startEvent();
    const m = await SwissMatch.findOne({ tournamentId, swissRound: 1, matchNumber: 1 });

    const res = await request(app)
      .post("/api/tournaments/matches/bulk-upload-scores")
      .set("Authorization", `Bearer ${token}`)
      .send({
        tournamentId,
        // One set does not decide a best-of-3.
        scores: [{ matchId: String(m._id), sets: [{ player1Score: 21, player2Score: 15 }] }],
      });

    expect(res.status).toBe(200);
    expect(res.body.errors.length).toBeGreaterThan(0);
    expect((await SwissMatch.findById(m._id)).status).not.toBe("COMPLETED");
  });

  test("a scored Swiss match feeds the standings and unlocks the next round", async () => {
    const { tournamentId, sportId } = await startEvent(4, 2);
    const r1 = await SwissMatch.find({ tournamentId, swissRound: 1 }).sort({ matchNumber: 1 });

    const res = await request(app)
      .post("/api/tournaments/matches/bulk-upload-scores")
      .set("Authorization", `Bearer ${token}`)
      .send({
        tournamentId,
        scores: r1.map((m) => ({
          matchId: String(m._id),
          sets: [{ player1Score: 21, player2Score: 15 }, { player1Score: 21, player2Score: 12 }],
        })),
      });
    expect(res.body.errors || []).toHaveLength(0);

    const event = await request(app)
      .get(`/api/tournaments/swiss/${tournamentId}?sportId=${sportId}&category=Open`)
      .set("Authorization", `Bearer ${token}`);

    expect(event.body.canGenerateNextRound).toBe(true);
    // Both round-1 player1s won, so both sit on 1 point.
    const leaders = event.body.standings.filter((r) => r.score === 1);
    expect(leaders).toHaveLength(2);

    const next = await request(app)
      .post(`/api/tournaments/swiss/${tournamentId}/next-round`)
      .set("Authorization", `Bearer ${token}`)
      .send({ sportId, category: "Open" });
    expect(next.status).toBe(201);
  });
});

describe("the shared live-scoring engine resolves Swiss matches", () => {
  test("live state is readable for a Swiss match", async () => {
    const { tournamentId } = await startEvent();
    const m = await SwissMatch.findOne({ tournamentId, swissRound: 1, matchNumber: 1 });

    const res = await request(app)
      .get(`/api/tournaments/matches/${String(m._id)}/live-state`)
      .set("Authorization", `Bearer ${token}`);

    // The point is that the lookup RESOLVES — a Swiss match must not fall
    // through to "Match not found in any collection".
    expect(res.status).not.toBe(404);
  });

  test("a Swiss match is not reported as missing by the score reader", async () => {
    const { tournamentId } = await startEvent();
    const m = await SwissMatch.findOne({ tournamentId, swissRound: 1, matchNumber: 1 });

    const res = await request(app)
      .get(`/api/tournaments/matches/${String(m._id)}/scores`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).not.toBe(404);
  });
});

describe("existing match types are unaffected by the new fallback", () => {
  test("an unknown id still 404s rather than matching something", async () => {
    await startEvent();
    const res = await request(app)
      .get("/api/tournaments/matches/6a7b0000000000000000dead/live-state")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  test("bulk upload still reports a genuinely missing match", async () => {
    const { tournamentId } = await startEvent();
    const res = await request(app)
      .post("/api/tournaments/matches/bulk-upload-scores")
      .set("Authorization", `Bearer ${token}`)
      .send({
        tournamentId,
        scores: [{
          matchId: "6a7b0000000000000000dead",
          sets: [{ player1Score: 21, player2Score: 15 }, { player1Score: 21, player2Score: 12 }],
        }],
      });
    expect(res.body.errors[0].error).toMatch(/not found/i);
  });
});
