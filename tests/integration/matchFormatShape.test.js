"use strict";
/**
 * Flat vs nested match shape across the per-round bestOf escalation.
 *
 * A knockout bracket escalates Bo3 (early) → Bo5 (semi) → Bo7 (final) by
 * overriding { totalSets, setsToWin }. Flat-set sports (badminton, table
 * tennis) encode "no games layer" as totalGames === totalSets, and
 * hasNestedGames() reads any other relationship as a Tennis-style nested match.
 *
 * Applying the override naively left totalGames at its base value while
 * totalSets rose, so the SEMI AND FINAL of a badminton draw were detected as
 * nested. That split the two scoring engines apart: the live scorer demanded
 * games within each set, while bulk upload recorded one game per set — the same
 * match stored two different structures depending on how it was scored.
 */
const request = require("supertest");
const {
  startTestApp, stopTestApp, superAdminToken, clearDatabase,
} = require("./setup");

const Tournament = require("../../src/modules/tournaments/models/Tournament");
const Sport = require("../../src/modules/catalog/models/Sport");
const DirectKnockoutMatch = require("../../src/modules/tournaments/models/DirectKnockoutMatch");
const { readMatchFormat } = require("../../utils/matchFormatUtils");
const { hasNestedGames } = require("../../factories/MatchFactory");

let app;
let token;

beforeAll(async () => { app = await startTestApp(); });
afterAll(stopTestApp);
beforeEach(async () => { await clearDatabase(); token = superAdminToken(); });

const EIGHT = ["A", "B", "C", "D", "E", "F", "G", "H"].map((n) => ({ userName: n }));

async function buildBracket(matchFormat, { sportName = "Badminton", category = "Racquet", scoringType = "sets" } = {}) {
  const sport = await Sport.create({ name: sportName, category, scoringType });
  const t = await Tournament.create({
    title: `${sportName} Shape Cup`,
    sports: [{
      sportId: sport._id, sportName, tournamentLevel: "unranked",
      categories: [{ name: "Open", fee: 0 }],
      matchFormat,
    }],
  });
  const res = await request(app)
    .post("/api/tournaments/direct-knockout/standalone/create")
    .set("Authorization", `Bearer ${token}`)
    .send({
      tournamentId: String(t._id), sportId: String(sport._id), category: "Open",
      players: EIGHT, drawSize: 8, drawMethod: "standard", confirm: true,
    });
  expect(res.status).toBe(201);
  return String(t._id);
}

describe("flat-set sports stay flat through the bestOf escalation", () => {
  test("badminton is flat in EVERY round, including the Bo5 semi and Bo7 final", async () => {
    const tournamentId = await buildBracket({
      scoringType: "sets", totalSets: 3, setsToWin: 2, pointsPerSet: 21,
    });

    for (const roundNumber of [1, 2, 3]) {
      const m = await DirectKnockoutMatch.findOne({ tournamentId, roundNumber, matchNumber: 1 });
      const fmt = readMatchFormat(m);

      // The defect: rounds 2 and 3 reported nested === true.
      expect(hasNestedGames(fmt)).toBe(false);
      // The invariant that encodes flatness.
      expect(fmt.totalGames).toBe(fmt.totalSets);
    }
  });

  test("the escalation still raises the set count per round", async () => {
    const tournamentId = await buildBracket({
      scoringType: "sets", totalSets: 3, setsToWin: 2, pointsPerSet: 21,
    });

    const read = async (roundNumber) =>
      readMatchFormat(await DirectKnockoutMatch.findOne({ tournamentId, roundNumber, matchNumber: 1 }));

    const [qf, sf, final] = [await read(1), await read(2), await read(3)];

    expect(qf.totalSets).toBe(3);
    expect(qf.setsToWin).toBe(2);
    expect(sf.totalSets).toBe(5);
    expect(sf.setsToWin).toBe(3);
    expect(final.totalSets).toBe(7);
    expect(final.setsToWin).toBe(4);
  });

  test("setsToWin never exceeds the set container in any round", async () => {
    const tournamentId = await buildBracket({
      scoringType: "sets", totalSets: 3, setsToWin: 2, pointsPerSet: 21,
    });

    const all = await DirectKnockoutMatch.find({ tournamentId });
    for (const m of all) {
      const fmt = readMatchFormat(m);
      expect(fmt.setsToWin).toBeLessThanOrEqual(Math.ceil(fmt.totalSets / 2));
      expect(fmt.setsToWin).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("genuinely nested sports keep their games layer", () => {
  test("a format with a real games layer stays nested in every round", async () => {
    // normalizeMatchFormat turns a tournament's gamesPerSet into totalGames,
    // which is what actually lands on the stored format — freezeMatchFormat
    // carries totalGames, not gamesPerSet. Use the stored shape here.
    const tournamentId = await buildBracket(
      { scoringType: "sets", totalSets: 3, setsToWin: 2, totalGames: 6, gamesToWin: 4, pointsToWinGame: 4 },
      { sportName: "Tennis" }
    );

    for (const roundNumber of [1, 2, 3]) {
      const m = await DirectKnockoutMatch.findOne({ tournamentId, roundNumber, matchNumber: 1 });
      const fmt = readMatchFormat(m);
      // Games per set is independent of how many sets the match runs to — the
      // escalation must not flatten a nested sport either.
      expect(hasNestedGames(fmt)).toBe(true);
    }
  });
});
