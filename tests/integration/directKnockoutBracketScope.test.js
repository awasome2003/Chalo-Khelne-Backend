"use strict";
/**
 * Direct Knockout — bracket isolation.
 *
 * Regression cover for the data-loss defect where generating any bracket ran an
 * unscoped `DirectKnockoutMatch.deleteMany({ tournamentId })`, so a tournament
 * could only ever hold ONE bracket: creating the Above-40 draw silently wiped
 * Open, and creating Carrom's wiped Badminton's.
 *
 * Generation is now scoped to (sport, category), and matchId carries a matching
 * discriminator so sibling brackets don't collide on the globally-unique index.
 *
 * Drives the real route stack:
 *   POST /api/tournaments/direct-knockout/standalone/create
 *   GET  /api/tournaments/direct-knockout/:tournamentId/matches
 *   DELETE /api/tournaments/direct-knockout/:tournamentId/reset
 */
const request = require("supertest");
const {
  startTestApp,
  stopTestApp,
  superAdminToken,
  clearDatabase,
} = require("./setup");

const Tournament = require("../../src/modules/tournaments/models/Tournament");
const Sport = require("../../src/modules/catalog/models/Sport");
const DirectKnockoutMatch = require("../../src/modules/tournaments/models/DirectKnockoutMatch");

let app;
let token;

beforeAll(async () => {
  app = await startTestApp();
});
afterAll(stopTestApp);

const mkPlayers = (names) => names.map((n) => ({ userName: n }));
const EIGHT = mkPlayers(["A", "B", "C", "D", "E", "F", "G", "H"]);

/** Seeds a two-sport tournament and returns { tournamentId, sports }. */
async function seedTournament() {
  const carrom = await Sport.create({ name: "Carrom", category: "Board", scoringType: "board" });
  const badminton = await Sport.create({ name: "Badminton", category: "Racquet", scoringType: "sets" });

  const t = await Tournament.create({
    title: "Bracket Scope Cup",
    sports: [
      {
        sportId: carrom._id,
        sportName: "Carrom",
        tournamentLevel: "unranked",
        categories: [{ name: "Open", fee: 0 }, { name: "Above 40", fee: 0 }],
        matchFormat: { scoringType: "board", boardsToWin: 3 },
      },
      {
        sportId: badminton._id,
        sportName: "Badminton",
        tournamentLevel: "unranked",
        categories: [{ name: "Open", fee: 0 }],
        matchFormat: { scoringType: "sets", totalSets: 3, pointsPerSet: 21 },
      },
    ],
  });

  return { tournamentId: String(t._id), carromId: String(carrom._id), badmintonId: String(badminton._id) };
}

/** POSTs a standalone bracket. Returns the supertest response. */
function createBracket({ tournamentId, sportId, category, players = EIGHT }) {
  return request(app)
    .post("/api/tournaments/direct-knockout/standalone/create")
    .set("Authorization", `Bearer ${token}`)
    .send({
      tournamentId,
      sportId,
      category,
      players,
      drawSize: 8,
      drawMethod: "standard",
      confirm: true,
    });
}

beforeEach(async () => {
  await clearDatabase();
  token = superAdminToken();
});

test("two categories of the same sport coexist — the second does not wipe the first", async () => {
  const { tournamentId, carromId } = await seedTournament();

  const open = await createBracket({ tournamentId, sportId: carromId, category: "Open" });
  expect(open.status).toBe(201);
  const openCount = await DirectKnockoutMatch.countDocuments({ tournamentId, category: "Open" });
  expect(openCount).toBe(7); // 8-draw = 7 matches

  const over40 = await createBracket({ tournamentId, sportId: carromId, category: "Above 40" });
  expect(over40.status).toBe(201);

  // The defect: this used to be 0.
  const openAfter = await DirectKnockoutMatch.countDocuments({ tournamentId, category: "Open" });
  expect(openAfter).toBe(7);
  const over40Count = await DirectKnockoutMatch.countDocuments({ tournamentId, category: "Above 40" });
  expect(over40Count).toBe(7);
  expect(await DirectKnockoutMatch.countDocuments({ tournamentId })).toBe(14);
});

test("two sports coexist — generating one does not wipe the other", async () => {
  const { tournamentId, carromId, badmintonId } = await seedTournament();

  expect((await createBracket({ tournamentId, sportId: carromId, category: "Open" })).status).toBe(201);
  expect((await createBracket({ tournamentId, sportId: badmintonId, category: "Open" })).status).toBe(201);

  expect(await DirectKnockoutMatch.countDocuments({ tournamentId, sportId: carromId })).toBe(7);
  expect(await DirectKnockoutMatch.countDocuments({ tournamentId, sportId: badmintonId })).toBe(7);
});

test("sibling brackets get distinct matchIds (no duplicate-key collision)", async () => {
  const { tournamentId, carromId } = await seedTournament();

  await createBracket({ tournamentId, sportId: carromId, category: "Open" });
  await createBracket({ tournamentId, sportId: carromId, category: "Above 40" });

  const all = await DirectKnockoutMatch.find({ tournamentId }).select("matchId").lean();
  const ids = all.map((m) => m.matchId);
  expect(ids).toHaveLength(14);
  expect(new Set(ids).size).toBe(14);
});

test("regenerating a bracket replaces only itself", async () => {
  const { tournamentId, carromId } = await seedTournament();

  await createBracket({ tournamentId, sportId: carromId, category: "Open" });
  await createBracket({ tournamentId, sportId: carromId, category: "Above 40" });

  // Regenerate Open with a different field.
  const again = await createBracket({
    tournamentId,
    sportId: carromId,
    category: "Open",
    players: mkPlayers(["P", "Q", "R", "S", "T", "U", "V", "W"]),
  });
  expect(again.status).toBe(201);

  expect(await DirectKnockoutMatch.countDocuments({ tournamentId })).toBe(14);
  const openR1 = await DirectKnockoutMatch.find({ tournamentId, category: "Open", roundNumber: 1 }).lean();
  const names = openR1.flatMap((m) => [m.player1?.playerName, m.player2?.playerName]);
  expect(names).toContain("P");
  expect(names).not.toContain("A");
  // The untouched sibling still holds its original field.
  const overR1 = await DirectKnockoutMatch.find({ tournamentId, category: "Above 40", roundNumber: 1 }).lean();
  expect(overR1.flatMap((m) => [m.player1?.playerName, m.player2?.playerName])).toContain("A");
});

test("GET scopes by sport and category", async () => {
  const { tournamentId, carromId, badmintonId } = await seedTournament();

  await createBracket({ tournamentId, sportId: carromId, category: "Open" });
  await createBracket({ tournamentId, sportId: carromId, category: "Above 40" });
  await createBracket({ tournamentId, sportId: badmintonId, category: "Open" });

  const bySport = await request(app)
    .get(`/api/tournaments/direct-knockout/${tournamentId}/matches?sportId=${carromId}`)
    .set("Authorization", `Bearer ${token}`);
  expect(bySport.status).toBe(200);
  expect(bySport.body.totalMatches).toBe(14);

  const byCategory = await request(app)
    .get(`/api/tournaments/direct-knockout/${tournamentId}/matches?sportId=${carromId}&category=Above%2040`)
    .set("Authorization", `Bearer ${token}`);
  expect(byCategory.status).toBe(200);
  expect(byCategory.body.totalMatches).toBe(7);
  expect(byCategory.body.matches.every((m) => m.category === "Above 40")).toBe(true);
});

test("reset scoped to a category leaves siblings intact", async () => {
  const { tournamentId, carromId } = await seedTournament();

  await createBracket({ tournamentId, sportId: carromId, category: "Open" });
  await createBracket({ tournamentId, sportId: carromId, category: "Above 40" });

  const res = await request(app)
    .delete(`/api/tournaments/direct-knockout/${tournamentId}/reset?sportId=${carromId}&category=Open`)
    .set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);

  expect(await DirectKnockoutMatch.countDocuments({ tournamentId, category: "Open" })).toBe(0);
  expect(await DirectKnockoutMatch.countDocuments({ tournamentId, category: "Above 40" })).toBe(7);
});

test("category omitted still clears every bracket for that sport (legacy behaviour)", async () => {
  const { tournamentId, carromId, badmintonId } = await seedTournament();

  await createBracket({ tournamentId, sportId: carromId, category: "Open" });
  await createBracket({ tournamentId, sportId: carromId, category: "Above 40" });
  await createBracket({ tournamentId, sportId: badmintonId, category: "Open" });

  const res = await request(app)
    .delete(`/api/tournaments/direct-knockout/${tournamentId}/reset?sportId=${carromId}`)
    .set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);

  expect(await DirectKnockoutMatch.countDocuments({ tournamentId, sportId: carromId })).toBe(0);
  expect(await DirectKnockoutMatch.countDocuments({ tournamentId, sportId: badmintonId })).toBe(7);
});
