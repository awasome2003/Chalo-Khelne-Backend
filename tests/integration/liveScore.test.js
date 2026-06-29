"use strict";
/**
 * CRITICAL FLOW 2 — Live score entry.
 *
 * Drives PUT /api/tournaments/matches/:matchId/live-score through the real
 * stack: allowUserOrManager → router.param("matchId") scorer guard
 * → requirePermission("tournament:score") → updateLiveScore.
 *
 * A match in IN_PROGRESS status is seeded directly (collection.insertOne bypasses
 * schema validation, like the tenancy suite) so the controller skips
 * auto-initialization and writes liveScore straight to the doc.
 */
const request = require("supertest");
const mongoose = require("mongoose");
const {
  startTestApp,
  stopTestApp,
  superAdminToken,
  clearDatabase,
} = require("./setup");

// Same model the score controller uses (model name "Match").
const Match = require("../../src/modules/tournaments/models/Tournnamentmatch");

let app;
let token;

beforeAll(async () => {
  app = await startTestApp();
});
afterAll(stopTestApp);

beforeEach(async () => {
  await clearDatabase();
  token = superAdminToken();
});

async function seedInProgressMatch() {
  const _id = new mongoose.Types.ObjectId();
  await Match.collection.insertOne({
    _id,
    tournamentId: new mongoose.Types.ObjectId(),
    sportName: "Carrom",
    status: "IN_PROGRESS",
  });
  return _id;
}

test("updates the live score and persists it", async () => {
  const matchId = await seedInProgressMatch();

  const res = await request(app)
    .put(`/api/tournaments/matches/${matchId}/live-score`)
    .set("Authorization", `Bearer ${token}`)
    .send({ player1Points: 5, player2Points: 3 });

  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.liveScore).toMatchObject({ player1Points: 5, player2Points: 3 });

  const saved = await Match.findById(matchId).lean();
  expect(saved.liveScore.player1Points).toBe(5);
  expect(saved.liveScore.player2Points).toBe(3);
});

test("rejects a score update with missing points (400)", async () => {
  const matchId = await seedInProgressMatch();

  const res = await request(app)
    .put(`/api/tournaments/matches/${matchId}/live-score`)
    .set("Authorization", `Bearer ${token}`)
    .send({ player1Points: 5 }); // player2Points missing

  expect(res.status).toBe(400);
});

test("returns 404 for a non-existent match", async () => {
  const ghostId = new mongoose.Types.ObjectId();

  const res = await request(app)
    .put(`/api/tournaments/matches/${ghostId}/live-score`)
    .set("Authorization", `Bearer ${token}`)
    .send({ player1Points: 1, player2Points: 1 });

  expect(res.status).toBe(404);
});
