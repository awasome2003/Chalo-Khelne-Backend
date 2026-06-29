"use strict";
/**
 * CRITICAL FLOW 1 — Tournament creation.
 *
 * Drives POST /api/tournaments/createTournament through the real route stack:
 *   allowUserOrManager → requirePermission("tournament:create")
 *   → multer (no file) → scopeTournamentCreate → createTournament
 *
 * Asserts the happy path persists a Tournament, and that the two guard rails
 * the controller actually enforces (auth required; sports[] required) hold.
 */
const request = require("supertest");
const mongoose = require("mongoose");
const {
  startTestApp,
  stopTestApp,
  superAdminToken,
  clearDatabase,
} = require("./setup");

const Tournament = require("../../src/modules/tournaments/models/Tournament");
const Sport = require("../../src/modules/catalog/models/Sport");

let app;
let token;

beforeAll(async () => {
  app = await startTestApp();
});
afterAll(stopTestApp);

beforeEach(async () => {
  await clearDatabase();
  token = superAdminToken();
  // The Tournament model requires each embedded sport to carry a real
  // sportId (ref Sport); the controller resolves it from sportName. Seed the
  // sport so resolution is deterministic. (slug auto-generates from name.)
  await Sport.create({ name: "Carrom", category: "Board", scoringType: "board" });
});

const validBody = {
  title: "Integration Test Cup",
  sports: [
    {
      sportName: "Carrom",
      tournamentLevel: "unranked", // skip the SportRuleBook lookup branch
      categories: [{ name: "Open", fee: 0 }],
    },
  ],
};

test("creates a tournament and persists it", async () => {
  const res = await request(app)
    .post("/api/tournaments/createTournament")
    .set("Authorization", `Bearer ${token}`)
    .send(validBody);

  expect(res.status).toBeLessThan(400);

  const saved = await Tournament.findOne({ title: "Integration Test Cup" }).lean();
  expect(saved).toBeTruthy();
  expect(saved.sports).toHaveLength(1);
  expect(saved.sports[0].sportName).toBe("Carrom");
  expect(String(saved.sports[0].sportId)).toMatch(/^[a-f0-9]{24}$/);
});

test("rejects an unauthenticated request (401)", async () => {
  const res = await request(app)
    .post("/api/tournaments/createTournament")
    .send(validBody);

  expect(res.status).toBe(401);
});

test("rejects a payload with no sports[] (400)", async () => {
  const res = await request(app)
    .post("/api/tournaments/createTournament")
    .set("Authorization", `Bearer ${token}`)
    .send({ title: "No Sports Cup" });

  expect(res.status).toBe(400);
});
