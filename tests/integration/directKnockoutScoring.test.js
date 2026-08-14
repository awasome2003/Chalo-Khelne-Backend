"use strict";
/**
 * Direct Knockout — scoring, BYE and draw-size guards.
 *
 * Regression cover for four defects:
 *   1. bulkUploadScores marked a match COMPLETED from an INCOMPLETE set list and
 *      handed the win to player2 via a fall-through ternary.
 *   2. The post-group create path had no minimum-player guard, so a short field
 *      could produce a BYE-vs-BYE first-round match that stalls the bracket.
 *   3. giveBye rejected guest-booking players (playerId: null) as "empty".
 *   4. completeGame omitted "board" (Carrom) from its non-set sports, so the
 *      same match stored a different shape live vs bulk-uploaded.
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
const DirectKnockoutMatch = require("../../src/modules/tournaments/models/DirectKnockoutMatch");
const dkController = require("../../controllers/directKnockoutController");

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

const mkPlayers = (names) => names.map((n) => ({ userName: n }));
const EIGHT = mkPlayers(["A", "B", "C", "D", "E", "F", "G", "H"]);

/** Seeds a single-sport tournament. `managerId` lets completeGame authorize. */
async function seedTournament({ sportName, category, scoringType, matchFormat, managerId }) {
  const sport = await Sport.create({ name: sportName, category, scoringType });
  const t = await Tournament.create({
    title: `${sportName} Cup`,
    ...(managerId ? { managerId: [managerId] } : {}),
    sports: [
      {
        sportId: sport._id,
        sportName,
        tournamentLevel: "unranked",
        categories: [{ name: "Open", fee: 0 }],
        matchFormat,
      },
    ],
  });
  return { tournamentId: String(t._id), sportId: String(sport._id) };
}

async function seedBadminton(managerId) {
  return seedTournament({
    sportName: "Badminton",
    category: "Racquet",
    scoringType: "sets",
    matchFormat: { scoringType: "sets", totalSets: 3, setsToWin: 2, pointsPerSet: 21 },
    managerId,
  });
}

/** Creates an 8-draw standalone bracket of guest players (playerId: null). */
async function createBracket(tournamentId, sportId, players = EIGHT) {
  const res = await request(app)
    .post("/api/tournaments/direct-knockout/standalone/create")
    .set("Authorization", `Bearer ${token}`)
    .send({ tournamentId, sportId, category: "Open", players, drawSize: 8, drawMethod: "standard", confirm: true });
  expect(res.status).toBe(201);
  return res;
}

// ── 1. Incomplete bulk score ─────────────────────────────────────────────
describe("bulkUploadScores — incomplete set lists", () => {
  test("rejects a best-of-3 upload carrying only one set, and completes nothing", async () => {
    const { tournamentId, sportId } = await seedBadminton();
    await createBracket(tournamentId, sportId);
    const target = await DirectKnockoutMatch.findOne({ tournamentId, roundNumber: 1, matchNumber: 1 });

    const res = await request(app)
      .post("/api/tournaments/direct-knockout/bulk-upload-scores")
      .set("Authorization", `Bearer ${token}`)
      .send({
        tournamentId,
        // Player 1 won the only set supplied — 1 set is not enough to win a Bo3.
        scores: [{ matchId: target.matchId, sets: [{ player1Score: 21, player2Score: 15 }] }],
      });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(0);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].error).toMatch(/Incomplete score/i);

    // The defect: this used to be COMPLETED with player2 ("B") as the winner —
    // the player who lost the only set that was actually played.
    const after = await DirectKnockoutMatch.findById(target._id).lean();
    expect(after.status).not.toBe("COMPLETED");
    expect(after.result?.winner?.playerName ?? null).toBeNull();
  });

  test("accepts a decisive best-of-3 upload and progresses the real winner", async () => {
    const { tournamentId, sportId } = await seedBadminton();
    await createBracket(tournamentId, sportId);
    const target = await DirectKnockoutMatch.findOne({ tournamentId, roundNumber: 1, matchNumber: 1 });
    const p1Name = target.player1.playerName;

    const res = await request(app)
      .post("/api/tournaments/direct-knockout/bulk-upload-scores")
      .set("Authorization", `Bearer ${token}`)
      .send({
        tournamentId,
        scores: [{
          matchId: target.matchId,
          sets: [{ player1Score: 21, player2Score: 15 }, { player1Score: 21, player2Score: 18 }],
        }],
      });

    expect(res.status).toBe(200);
    expect(res.body.errors).toHaveLength(0);
    expect(res.body.results[0].winner).toBe(p1Name);

    const after = await DirectKnockoutMatch.findById(target._id).lean();
    expect(after.status).toBe("COMPLETED");
    expect(after.result.winner.playerName).toBe(p1Name);

    const next = await DirectKnockoutMatch.findOne({ matchId: target.nextMatchId }).lean();
    expect(next.player1.playerName).toBe(p1Name);
  });
});

// ── 2. Minimum player guard on the post-group path ───────────────────────
describe("createDirectKnockoutMatches — draw-size guards", () => {
  const postGroup = (tournamentId, sportId, players) =>
    request(app)
      .post("/api/tournaments/direct-knockout/create-matches")
      .set("Authorization", `Bearer ${token}`)
      .send({
        tournamentId,
        sportId,
        selectedPlayers: players,
        drawMethod: "standard",
        schedule: { drawSize: 8, startDate: "2026-09-01", startTime: "09:00", courtNumber: "1" },
      });

  test("rejects a field too small for the draw (would strand a BYE-vs-BYE match)", async () => {
    const { tournamentId, sportId } = await seedBadminton();
    // An 8-draw needs 5+. Three players leaves a first-round match with BYEs on
    // both sides — permanently SCHEDULED, blocking the round above it.
    const res = await postGroup(tournamentId, sportId, mkPlayers(["A", "B", "C"]));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at least 5 players/i);
    expect(await DirectKnockoutMatch.countDocuments({ tournamentId })).toBe(0);
  });

  test("still rejects an oversized field", async () => {
    const { tournamentId, sportId } = await seedBadminton();
    const nine = mkPlayers(["A", "B", "C", "D", "E", "F", "G", "H", "I"]);
    const res = await postGroup(tournamentId, sportId, nine);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Too many players/i);
  });

  test("accepts the minimum viable field", async () => {
    const { tournamentId, sportId } = await seedBadminton();
    const res = await postGroup(tournamentId, sportId, mkPlayers(["A", "B", "C", "D", "E"]));

    expect(res.status).toBe(201);
    expect(await DirectKnockoutMatch.countDocuments({ tournamentId })).toBe(7);
  });
});

// ── 3. BYE for guest players ─────────────────────────────────────────────
describe("giveBye — guest-booking players", () => {
  test("advances the opponent when both players have a null playerId", async () => {
    const { tournamentId, sportId } = await seedBadminton();
    await createBracket(tournamentId, sportId);
    const target = await DirectKnockoutMatch.findOne({ tournamentId, roundNumber: 1, matchNumber: 1 });

    // Guest bookings carry no user account — identity is the name alone.
    expect(target.player1.playerId).toBeNull();
    expect(target.player2.playerId).toBeNull();

    const res = await request(app)
      .post(`/api/tournaments/direct-knockout/matches/${target.matchId}/bye`)
      .set("Authorization", `Bearer ${token}`)
      // giveBye resolves by name when playerId is absent.
      .send({ byePlayerId: target.player2.playerName });

    // The defect: this used to 400 with "the other player slot is empty".
    expect(res.status).toBe(200);
    expect(res.body.match.winner).toBe(target.player1.playerName);

    const after = await DirectKnockoutMatch.findById(target._id).lean();
    expect(after.status).toBe("COMPLETED");
    expect(after.result.winner.playerName).toBe(target.player1.playerName);

    const next = await DirectKnockoutMatch.findOne({ matchId: target.nextMatchId }).lean();
    expect(next.player1.playerName).toBe(target.player1.playerName);
  });

  test("still refuses when the opponent slot is a genuine placeholder", async () => {
    const { tournamentId, sportId } = await seedBadminton();
    await createBracket(tournamentId, sportId);
    // Round 2 slots are unfilled until round 1 resolves.
    const r2 = await DirectKnockoutMatch.findOne({ tournamentId, roundNumber: 2, matchNumber: 1 });
    expect(r2.player1.playerName).toBe("TBD");

    const res = await request(app)
      .post(`/api/tournaments/direct-knockout/matches/${r2.matchId}/bye`)
      .set("Authorization", `Bearer ${token}`)
      .send({ byePlayerId: "TBD" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/empty/i);
  });
});

// ── 4. Board (Carrom) scored live ────────────────────────────────────────
describe("completeGame — board sports", () => {
  test("stores the non-set shape for Carrom, matching the bulk-upload path", async () => {
    const managerId = new mongoose.Types.ObjectId();
    const { tournamentId, sportId } = await seedTournament({
      sportName: "Carrom",
      category: "Board",
      scoringType: "board",
      matchFormat: { scoringType: "board", boardsToWin: 3, totalSets: 5 },
      managerId,
    });
    await createBracket(tournamentId, sportId);
    const target = await DirectKnockoutMatch.findOne({ tournamentId, roundNumber: 1, matchNumber: 1 });

    // Driven directly: the HTTP route needs a seeded RBAC graph, while the
    // controller's own guard only needs the Manager identity. The branch under
    // test is the same either way.
    const req = {
      params: { matchId: target.matchId },
      body: { player1Score: 3, player2Score: 1 },
      user: { _id: managerId },
      userRole: "Manager",
    };
    let payload = null;
    let statusCode = 200;
    const res = {
      status(code) { statusCode = code; return this; },
      json(body) { payload = body; return this; },
    };
    await dkController.completeGame(req, res);

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);

    const after = await DirectKnockoutMatch.findById(target._id).lean();
    expect(after.status).toBe("COMPLETED");
    // The discriminator: the non-set branch writes a normalized matchResult
    // carrying the real scoringType. The set-based branch leaves it null.
    expect(after.matchResult).toBeTruthy();
    expect(after.matchResult.scoringType).toBe("board");
    expect(after.matchResult.player1Score).toBe(3);
    expect(after.matchResult.player2Score).toBe(1);
    // Board totals, not a set tally.
    expect(after.result.finalScore.player1Sets).toBe(3);
    expect(after.result.winner.playerName).toBe(target.player1.playerName);
    // One synthetic container, not a per-set breakdown.
    expect(after.sets).toHaveLength(1);

    const next = await DirectKnockoutMatch.findOne({ matchId: target.nextMatchId }).lean();
    expect(next.player1.playerName).toBe(target.player1.playerName);
  });
});
