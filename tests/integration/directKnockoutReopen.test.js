"use strict";
/**
 * Direct Knockout — reopening a completed match (re-score / undo).
 *
 * Before this existed, a completed match was final: completeGame rejects
 * anything already COMPLETED and there was no correction path, so a single
 * mistyped score meant resetting the whole bracket.
 *
 * Undo is not simply "clear the result". Completing a match also advances the
 * winner, so reopening must retract them from the next round — and if that next
 * match has already been played, its result was produced by a player who may
 * not belong there. Those downstream results are invalidated too, which needs an
 * explicit { cascade: true } rather than happening silently.
 */
const request = require("supertest");
const {
  startTestApp, stopTestApp, superAdminToken, clearDatabase,
} = require("./setup");

const Tournament = require("../../src/modules/tournaments/models/Tournament");
const Sport = require("../../src/modules/catalog/models/Sport");
const DirectKnockoutMatch = require("../../src/modules/tournaments/models/DirectKnockoutMatch");

let app;
let token;

beforeAll(async () => { app = await startTestApp(); });
afterAll(stopTestApp);
beforeEach(async () => { await clearDatabase(); token = superAdminToken(); });

const EIGHT = ["A", "B", "C", "D", "E", "F", "G", "H"].map((n) => ({ userName: n }));

async function seedBracket() {
  const sport = await Sport.create({ name: "Badminton", category: "Racquet", scoringType: "sets" });
  const t = await Tournament.create({
    title: "Reopen Cup",
    sports: [{
      sportId: sport._id, sportName: "Badminton", tournamentLevel: "unranked",
      categories: [{ name: "Open", fee: 0 }],
      matchFormat: { scoringType: "sets", totalSets: 3, setsToWin: 2, pointsPerSet: 21 },
    }],
  });
  const tournamentId = String(t._id);
  const res = await request(app)
    .post("/api/tournaments/direct-knockout/standalone/create")
    .set("Authorization", `Bearer ${token}`)
    .send({
      tournamentId, sportId: String(sport._id), category: "Open",
      players: EIGHT, drawSize: 8, drawMethod: "standard", confirm: true,
    });
  expect(res.status).toBe(201);
  return { tournamentId };
}

/**
 * Score a match so player1 wins in straight sets. Reads the match's OWN
 * setsToWin rather than assuming Bo3 — the per-round cascade makes round 1 Bo3,
 * the semi Bo5 and the final Bo7, and a short score is correctly rejected as
 * incomplete.
 */
async function scoreMatch(matchId) {
  const m = await DirectKnockoutMatch.findOne({ matchId });
  const setsToWin = m.matchFormat?.setsToWin || 2;
  const sets = Array.from({ length: setsToWin }, () => ({
    player1Score: 21, player2Score: 15,
  }));

  const res = await request(app)
    .post("/api/tournaments/direct-knockout/bulk-upload-scores")
    .set("Authorization", `Bearer ${token}`)
    .send({ tournamentId: m.tournamentId, scores: [{ matchId, sets }] });
  expect(res.body.errors).toHaveLength(0);
  return res;
}

const reopen = (matchId, body = {}) =>
  request(app)
    .post(`/api/tournaments/direct-knockout/matches/${matchId}/reopen`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);

const load = (matchId) => DirectKnockoutMatch.findOne({ matchId }).lean();
const r1m1 = (tid) => DirectKnockoutMatch.findOne({ tournamentId: tid, roundNumber: 1, matchNumber: 1 });

describe("reopening a single completed match", () => {
  test("clears the result and retracts the winner from the next round", async () => {
    const { tournamentId } = await seedBracket();
    const m = await r1m1(tournamentId);
    await scoreMatch(m.matchId);

    const winnerName = (await load(m.matchId)).result.winner.playerName;
    const nextBefore = await load(m.nextMatchId);
    expect(nextBefore.player1.playerName).toBe(winnerName);

    const res = await reopen(m.matchId);
    expect(res.status).toBe(200);
    expect(res.body.reopened).toEqual([m.matchId]);

    const after = await load(m.matchId);
    expect(after.status).toBe("SCHEDULED");
    expect(after.result.winner.playerName).toBeNull();
    expect(after.result.finalScore).toEqual({ player1Sets: 0, player2Sets: 0 });
    expect(after.matchResult).toBeNull();
    expect(after.sets).toEqual([]);
    expect(after.currentSet).toBe(1);

    // The advanced player is gone from the next round.
    const nextAfter = await load(m.nextMatchId);
    expect(nextAfter.player1.playerName).toBe("TBD");
    expect(nextAfter.player1.playerId).toBeNull();

    // The players themselves are untouched — the match can be replayed.
    expect(after.player1.playerName).toBe(m.player1.playerName);
    expect(after.player2.playerName).toBe(m.player2.playerName);
  });

  test("the reopened match can be scored again, with a different winner", async () => {
    const { tournamentId } = await seedBracket();
    const m = await r1m1(tournamentId);
    await scoreMatch(m.matchId);
    await reopen(m.matchId);

    // Score it the other way this time.
    const res = await request(app)
      .post("/api/tournaments/direct-knockout/bulk-upload-scores")
      .set("Authorization", `Bearer ${token}`)
      .send({
        tournamentId,
        scores: [{
          matchId: m.matchId,
          sets: [{ player1Score: 15, player2Score: 21 }, { player1Score: 18, player2Score: 21 }],
        }],
      });
    expect(res.body.errors).toHaveLength(0);

    const after = await load(m.matchId);
    expect(after.status).toBe("COMPLETED");
    expect(after.result.winner.playerName).toBe(m.player2.playerName);

    // And the corrected winner is the one who advanced.
    const next = await load(m.nextMatchId);
    expect(next.player1.playerName).toBe(m.player2.playerName);
  });

  test("does not disturb the sibling entrant already in the next round", async () => {
    const { tournamentId } = await seedBracket();
    const m1 = await DirectKnockoutMatch.findOne({ tournamentId, roundNumber: 1, matchNumber: 1 });
    const m2 = await DirectKnockoutMatch.findOne({ tournamentId, roundNumber: 1, matchNumber: 2 });
    await scoreMatch(m1.matchId);
    await scoreMatch(m2.matchId);

    const m2Winner = (await load(m2.matchId)).result.winner.playerName;
    await reopen(m1.matchId);

    const next = await load(m1.nextMatchId);
    expect(next.player1.playerName).toBe("TBD");   // retracted
    expect(next.player2.playerName).toBe(m2Winner); // untouched
  });
});

describe("guards", () => {
  test("refuses a match that has not been played", async () => {
    const { tournamentId } = await seedBracket();
    const m = await r1m1(tournamentId);

    const res = await reopen(m.matchId);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/only a completed match/i);
  });

  test("returns 404 for an unknown match", async () => {
    await seedBracket();
    const res = await reopen("DK-does-not-exist-R1-M1");
    expect(res.status).toBe(404);
  });

  test("refuses a match decided by an automatic BYE", async () => {
    // 5 players in an 8-draw ⇒ some first-round matches are auto-BYEs.
    const sport = await Sport.create({ name: "Badminton", category: "Racquet", scoringType: "sets" });
    const t = await Tournament.create({
      title: "Bye Cup",
      sports: [{
        sportId: sport._id, sportName: "Badminton", tournamentLevel: "unranked",
        categories: [{ name: "Open", fee: 0 }],
        matchFormat: { scoringType: "sets", totalSets: 3, setsToWin: 2 },
      }],
    });
    await request(app)
      .post("/api/tournaments/direct-knockout/standalone/create")
      .set("Authorization", `Bearer ${token}`)
      .send({
        tournamentId: String(t._id), sportId: String(sport._id), category: "Open",
        players: ["A", "B", "C", "D", "E"].map((n) => ({ userName: n })),
        drawSize: 8, drawMethod: "standard", confirm: true,
      });

    const autoBye = await DirectKnockoutMatch.findOne({
      tournamentId: t._id, roundNumber: 1, status: "COMPLETED",
    });
    expect(autoBye).toBeTruthy();

    const res = await reopen(autoBye.matchId);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/automatic BYE/i);
  });
});

describe("downstream results", () => {
  test("refuses without cascade when a later match was played on this result", async () => {
    const { tournamentId } = await seedBracket();
    const m1 = await DirectKnockoutMatch.findOne({ tournamentId, roundNumber: 1, matchNumber: 1 });
    const m2 = await DirectKnockoutMatch.findOne({ tournamentId, roundNumber: 1, matchNumber: 2 });
    await scoreMatch(m1.matchId);
    await scoreMatch(m2.matchId);
    await scoreMatch(m1.nextMatchId); // the semi-final both feed

    const res = await reopen(m1.matchId);
    expect(res.status).toBe(409);
    expect(res.body.cascadeRequired).toBe(true);
    expect(res.body.affectedMatches).toHaveLength(1);
    expect(res.body.affectedMatches[0].matchId).toBe(m1.nextMatchId);

    // Nothing was changed by the refusal.
    expect((await load(m1.matchId)).status).toBe("COMPLETED");
    expect((await load(m1.nextMatchId)).status).toBe("COMPLETED");
  });

  test("cascade clears the whole dependent chain", async () => {
    const { tournamentId } = await seedBracket();
    const all = await DirectKnockoutMatch.find({ tournamentId, roundNumber: 1 }).sort({ matchNumber: 1 });
    for (const m of all) await scoreMatch(m.matchId);

    const semis = await DirectKnockoutMatch.find({ tournamentId, roundNumber: 2 }).sort({ matchNumber: 1 });
    for (const m of semis) await scoreMatch(m.matchId);

    const final = await DirectKnockoutMatch.findOne({ tournamentId, roundNumber: 3 });
    await scoreMatch(final.matchId);

    const m1 = all[0];
    const res = await reopen(m1.matchId, { cascade: true });
    expect(res.status).toBe(200);
    // R1M1 itself, plus the semi it feeds, plus the final.
    expect(res.body.reopened).toHaveLength(3);
    expect(res.body.reopened).toEqual(
      expect.arrayContaining([m1.matchId, semis[0].matchId, final.matchId])
    );

    for (const id of [m1.matchId, semis[0].matchId, final.matchId]) {
      const doc = await load(id);
      expect(doc.status).toBe("SCHEDULED");
      expect(doc.result.winner.playerName).toBeNull();
    }

    // The other half of the draw is untouched.
    expect((await load(semis[1].matchId)).status).toBe("COMPLETED");
    expect((await load(all[2].matchId)).status).toBe("COMPLETED");

    // The final's slot fed by the reopened semi is cleared; the other remains.
    const finalAfter = await load(final.matchId);
    expect(finalAfter.player1.playerName).toBe("TBD");
    expect(finalAfter.player2.playerName).not.toBe("TBD");
  });

  test("cascade is unnecessary when the next round has not been played", async () => {
    const { tournamentId } = await seedBracket();
    const m1 = await r1m1(tournamentId);
    await scoreMatch(m1.matchId);

    const res = await reopen(m1.matchId); // no cascade flag needed
    expect(res.status).toBe(200);
    expect(res.body.reopened).toEqual([m1.matchId]);
  });
});
