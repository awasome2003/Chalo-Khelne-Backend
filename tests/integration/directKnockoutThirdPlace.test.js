"use strict";
/**
 * Direct Knockout — third-place play-off.
 *
 * An optional extra match between the two semi-final losers, whose winner takes
 * 3rd place. Created on demand (the manager's choice, and the entrants aren't
 * known until both semis finish) rather than during bracket generation.
 *
 * It is terminal — no nextMatchId — and shares the final's roundNumber while
 * taking matchNumber 2, so the two can never collide on the unique matchId.
 */
const request = require("supertest");
const {
  startTestApp, stopTestApp, superAdminToken, clearDatabase,
} = require("./setup");

const Tournament = require("../../src/modules/tournaments/models/Tournament");
const Sport = require("../../src/modules/catalog/models/Sport");
const DirectKnockoutMatch = require("../../src/modules/tournaments/models/DirectKnockoutMatch");
const { gatherTournamentResults } = require("../../utils/tournamentResults");

let app;
let token;

beforeAll(async () => { app = await startTestApp(); });
afterAll(stopTestApp);
beforeEach(async () => { await clearDatabase(); token = superAdminToken(); });

const NAMES = ["A", "B", "C", "D", "E", "F", "G", "H"];

async function seedBracket(drawSize = 8) {
  const sport = await Sport.create({ name: "Badminton", category: "Racquet", scoringType: "sets" });
  const t = await Tournament.create({
    title: "Third Place Cup",
    sports: [{
      sportId: sport._id, sportName: "Badminton", tournamentLevel: "unranked",
      categories: [{ name: "Open", fee: 0 }],
      matchFormat: { scoringType: "sets", totalSets: 3, setsToWin: 2, pointsPerSet: 21 },
    }],
  });
  const tournamentId = String(t._id);
  const sportId = String(sport._id);
  const res = await request(app)
    .post("/api/tournaments/direct-knockout/standalone/create")
    .set("Authorization", `Bearer ${token}`)
    .send({
      tournamentId, sportId, category: "Open",
      players: NAMES.slice(0, drawSize).map((n) => ({ userName: n })),
      drawSize, drawMethod: "standard", confirm: true,
    });
  expect(res.status).toBe(201);
  return { tournamentId, sportId };
}

/** Score a match so the chosen slot wins, respecting that round's format. */
async function scoreMatch(matchId, winnerSlot = "player1") {
  const m = await DirectKnockoutMatch.findOne({ matchId });
  const setsToWin = m.matchFormat?.setsToWin || 2;
  const hi = 21, lo = 15;
  const sets = Array.from({ length: setsToWin }, () => ({
    player1Score: winnerSlot === "player1" ? hi : lo,
    player2Score: winnerSlot === "player1" ? lo : hi,
  }));
  const res = await request(app)
    .post("/api/tournaments/direct-knockout/bulk-upload-scores")
    .set("Authorization", `Bearer ${token}`)
    .send({ tournamentId: m.tournamentId, scores: [{ matchId, sets }] });
  expect(res.body.errors).toHaveLength(0);
}

const createPlayoff = (tournamentId, body = {}) =>
  request(app)
    .post(`/api/tournaments/direct-knockout/${tournamentId}/third-place`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);

const deletePlayoff = (tournamentId, sportId) =>
  request(app)
    .delete(`/api/tournaments/direct-knockout/${tournamentId}/third-place?sportId=${sportId}&category=Open`)
    .set("Authorization", `Bearer ${token}`);

/** Play round 1 and both semis; returns the two semi losers' names. */
async function playToFinal(tournamentId) {
  const r1 = await DirectKnockoutMatch.find({ tournamentId, roundNumber: 1 }).sort({ matchNumber: 1 });
  for (const m of r1) await scoreMatch(m.matchId, "player1");

  const semis = await DirectKnockoutMatch.find({ tournamentId, roundNumber: 2 }).sort({ matchNumber: 1 });
  for (const m of semis) await scoreMatch(m.matchId, "player1");

  const fresh = await DirectKnockoutMatch.find({ tournamentId, roundNumber: 2 }).sort({ matchNumber: 1 });
  // player1 won each semi, so player2 is the loser.
  return fresh.map((m) => m.player2.playerName);
}

describe("creating the play-off", () => {
  test("pairs the two semi-final losers", async () => {
    const { tournamentId, sportId } = await seedBracket();
    const losers = await playToFinal(tournamentId);

    const res = await createPlayoff(tournamentId, { sportId, category: "Open" });
    expect(res.status).toBe(201);

    const pm = await DirectKnockoutMatch.findOne({ tournamentId, round: "third-place" }).lean();
    expect(pm).toBeTruthy();
    expect([pm.player1.playerName, pm.player2.playerName].sort()).toEqual([...losers].sort());
    expect(pm.status).toBe("SCHEDULED");
  });

  test("is terminal — nobody advances out of it", async () => {
    const { tournamentId, sportId } = await seedBracket();
    await playToFinal(tournamentId);
    await createPlayoff(tournamentId, { sportId, category: "Open" });

    const pm = await DirectKnockoutMatch.findOne({ tournamentId, round: "third-place" }).lean();
    expect(pm.nextMatchId).toBeNull();
  });

  test("does not collide with the final's matchId", async () => {
    const { tournamentId, sportId } = await seedBracket();
    await playToFinal(tournamentId);
    await createPlayoff(tournamentId, { sportId, category: "Open" });

    const all = await DirectKnockoutMatch.find({ tournamentId }).select("matchId").lean();
    const ids = all.map((m) => m.matchId);
    expect(new Set(ids).size).toBe(ids.length);

    const pm = await DirectKnockoutMatch.findOne({ tournamentId, round: "third-place" }).lean();
    const final = await DirectKnockoutMatch.findOne({ tournamentId, round: "final" }).lean();
    expect(pm.roundNumber).toBe(final.roundNumber);
    expect(pm.matchId).not.toBe(final.matchId);
  });

  test("inherits the final's match format", async () => {
    const { tournamentId, sportId } = await seedBracket();
    await playToFinal(tournamentId);
    await createPlayoff(tournamentId, { sportId, category: "Open" });

    const pm = await DirectKnockoutMatch.findOne({ tournamentId, round: "third-place" }).lean();
    const final = await DirectKnockoutMatch.findOne({ tournamentId, round: "final" }).lean();
    expect(pm.matchFormat.setsToWin).toBe(final.matchFormat.setsToWin);
  });

  test("is scheduled after the final, not on top of it", async () => {
    const { tournamentId, sportId } = await seedBracket();
    await playToFinal(tournamentId);
    await createPlayoff(tournamentId, { sportId, category: "Open", gapMinutes: 30 });

    const pm = await DirectKnockoutMatch.findOne({ tournamentId, round: "third-place" }).lean();
    const final = await DirectKnockoutMatch.findOne({ tournamentId, round: "final" }).lean();
    const deltaMin =
      (new Date(pm.matchStartTime) - new Date(final.matchStartTime)) / 60000;
    expect(deltaMin).toBe(30);
  });
});

describe("guards", () => {
  test("refuses while a semi-final is still unplayed", async () => {
    const { tournamentId, sportId } = await seedBracket();
    const r1 = await DirectKnockoutMatch.find({ tournamentId, roundNumber: 1 }).sort({ matchNumber: 1 });
    for (const m of r1) await scoreMatch(m.matchId, "player1");
    // Only one semi played.
    const semis = await DirectKnockoutMatch.find({ tournamentId, roundNumber: 2 }).sort({ matchNumber: 1 });
    await scoreMatch(semis[0].matchId, "player1");

    const res = await createPlayoff(tournamentId, { sportId, category: "Open" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/semi-finals must be completed/i);
    expect(await DirectKnockoutMatch.countDocuments({ tournamentId, round: "third-place" })).toBe(0);
  });

  test("refuses a second play-off for the same bracket", async () => {
    const { tournamentId, sportId } = await seedBracket();
    await playToFinal(tournamentId);
    expect((await createPlayoff(tournamentId, { sportId, category: "Open" })).status).toBe(201);

    const res = await createPlayoff(tournamentId, { sportId, category: "Open" });
    expect(res.status).toBe(409);
    expect(await DirectKnockoutMatch.countDocuments({ tournamentId, round: "third-place" })).toBe(1);
  });

  test("works on the smallest bracket, where round 1 IS the semi-final", async () => {
    // 4 is the smallest supported draw: round 1 is the semi-final and round 2
    // the final. The semi round is derived from the bracket's own depth rather
    // than assumed, so this must work without special-casing.
    const { tournamentId, sportId } = await seedBracket(4);
    const r1 = await DirectKnockoutMatch.find({ tournamentId, roundNumber: 1 }).sort({ matchNumber: 1 });
    for (const m of r1) await scoreMatch(m.matchId, "player1");

    const res = await createPlayoff(tournamentId, { sportId, category: "Open" });
    expect(res.status).toBe(201);

    const pm = await DirectKnockoutMatch.findOne({ tournamentId, round: "third-place" }).lean();
    expect([pm.player1.playerName, pm.player2.playerName].sort())
      .toEqual(r1.map((m) => m.player2.playerName).sort());
  });

  test("404s when the bracket does not exist", async () => {
    const { tournamentId } = await seedBracket();
    const res = await createPlayoff(tournamentId, { sportId: "000000000000000000000000", category: "Open" });
    expect(res.status).toBe(404);
  });
});

describe("playing the play-off", () => {
  test("its winner takes third place on the podium", async () => {
    const { tournamentId, sportId } = await seedBracket();
    const losers = await playToFinal(tournamentId);

    const final = await DirectKnockoutMatch.findOne({ tournamentId, round: "final" });
    await scoreMatch(final.matchId, "player1");

    await createPlayoff(tournamentId, { sportId, category: "Open" });
    const pm = await DirectKnockoutMatch.findOne({ tournamentId, round: "third-place" });
    await scoreMatch(pm.matchId, "player2"); // the second-listed loser wins

    const results = await gatherTournamentResults(tournamentId);
    const podium = results.brackets[0].podium;

    const playoffWinner = (await DirectKnockoutMatch.findOne({ tournamentId, round: "third-place" }).lean())
      .result.winner.playerName;
    expect(losers).toContain(playoffWinner);

    // Decided outright — one name, not both semi losers tied.
    expect(podium.thirdPlace).toEqual([playoffWinner]);
    expect(podium.playoffPlayed).toBe(true);
  });

  test("without a play-off both semi losers share third", async () => {
    const { tournamentId } = await seedBracket();
    const losers = await playToFinal(tournamentId);
    const final = await DirectKnockoutMatch.findOne({ tournamentId, round: "final" });
    await scoreMatch(final.matchId, "player1");

    const results = await gatherTournamentResults(tournamentId);
    const podium = results.brackets[0].podium;

    expect(podium.thirdPlace.sort()).toEqual([...losers].sort());
    expect(podium.playoffPlayed).toBe(false);
  });

  test("the play-off never displaces the champion", async () => {
    const { tournamentId, sportId } = await seedBracket();
    await playToFinal(tournamentId);
    const final = await DirectKnockoutMatch.findOne({ tournamentId, round: "final" });
    await scoreMatch(final.matchId, "player1");
    const champion = (await DirectKnockoutMatch.findOne({ tournamentId, round: "final" }).lean())
      .result.winner.playerName;

    await createPlayoff(tournamentId, { sportId, category: "Open" });
    const pm = await DirectKnockoutMatch.findOne({ tournamentId, round: "third-place" });
    await scoreMatch(pm.matchId, "player1");

    const results = await gatherTournamentResults(tournamentId);
    // It shares the final's round number — it must not be read as the final.
    expect(results.brackets[0].podium.champion).toBe(champion);
  });
});

describe("removing the play-off", () => {
  test("can be deleted while unplayed", async () => {
    const { tournamentId, sportId } = await seedBracket();
    await playToFinal(tournamentId);
    await createPlayoff(tournamentId, { sportId, category: "Open" });

    const res = await deletePlayoff(tournamentId, sportId);
    expect(res.status).toBe(200);
    expect(await DirectKnockoutMatch.countDocuments({ tournamentId, round: "third-place" })).toBe(0);
  });

  test("refuses to delete a played play-off", async () => {
    const { tournamentId, sportId } = await seedBracket();
    await playToFinal(tournamentId);
    await createPlayoff(tournamentId, { sportId, category: "Open" });
    const pm = await DirectKnockoutMatch.findOne({ tournamentId, round: "third-place" });
    await scoreMatch(pm.matchId, "player1");

    const res = await deletePlayoff(tournamentId, sportId);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/reopen it first/i);
    expect(await DirectKnockoutMatch.countDocuments({ tournamentId, round: "third-place" })).toBe(1);
  });
});
