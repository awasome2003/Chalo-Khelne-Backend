"use strict";
/**
 * matchFormat persistence — the frozen format must survive the save.
 *
 * MatchFactory freezes a 24-field format onto every match, but the match models
 * only declared the original racquet subset. Mongoose drops undeclared paths
 * silently, so 19 fields were computed and thrown away on write — including
 * `totalSets`, which the scoring engine reads to decide how many sets a match
 * needs. Its absence made readMatchFormat fall back to totalSets=1 →
 * setsToWin=1, i.e. EVERY set-based match was scored best-of-1 and the
 * per-round bestOf (Bo3/Bo5/Bo7) was silently discarded.
 *
 * These tests assert the round trip: what freezeMatchFormat produces is what
 * comes back out of the database, and what readMatchFormat then reports.
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
const SuperMatch = require("../../src/modules/tournaments/models/SuperMatch");
const Match = require("../../src/modules/tournaments/models/Tournnamentmatch");
const { freezeMatchFormat, readMatchFormat } = require("../../utils/matchFormatUtils");

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

const EIGHT = ["A", "B", "C", "D", "E", "F", "G", "H"].map((n) => ({ userName: n }));

// Fields freezeMatchFormat emits that the models previously did not declare.
const PREVIOUSLY_STRIPPED = [
  "totalSets", "totalGames", "scoringType", "formatVersion",
  "maxPointsCap", "tiebreakEnabled", "tiebreakPoints", "decidingSetPoints",
  "serviceAlternate", "oversCount", "inningsCount", "superOver",
  "halvesCount", "halvesDuration", "quartersCount", "quartersDuration",
  "boardsToWin", "pointsPerBoard", "queenValue",
];

async function seed({ sportName, category, scoringType, matchFormat }) {
  const sport = await Sport.create({ name: sportName, category, scoringType });
  const t = await Tournament.create({
    title: `${sportName} Persistence Cup`,
    sports: [{
      sportId: sport._id,
      sportName,
      tournamentLevel: "unranked",
      categories: [{ name: "Open", fee: 0 }],
      matchFormat,
    }],
  });
  return { tournamentId: String(t._id), sportId: String(sport._id) };
}

async function generateBracket(tournamentId, sportId) {
  const res = await request(app)
    .post("/api/tournaments/direct-knockout/standalone/create")
    .set("Authorization", `Bearer ${token}`)
    .send({
      tournamentId, sportId, category: "Open",
      players: EIGHT, drawSize: 8, drawMethod: "standard", confirm: true,
    });
  expect(res.status).toBe(201);
}

describe("the schema declares every field the factory freezes", () => {
  test.each([
    ["DirectKnockoutMatch", DirectKnockoutMatch],
    ["SuperMatch", SuperMatch],
    ["Match (group stage)", Match],
  ])("%s declares all previously-stripped paths", (_label, Model) => {
    const missing = PREVIOUSLY_STRIPPED.filter(
      (f) => !Model.schema.path(`matchFormat.${f}`)
    );
    expect(missing).toEqual([]);
  });

  test("the declared paths cover freezeMatchFormat's full output", () => {
    const frozen = freezeMatchFormat({ scoringType: "sets", totalSets: 3 });
    const undeclared = Object.keys(frozen).filter(
      (f) => !DirectKnockoutMatch.schema.path(`matchFormat.${f}`)
    );
    expect(undeclared).toEqual([]);
  });
});

describe("badminton — set counts survive the round trip", () => {
  test("a best-of-3 tournament stores totalSets and reads back setsToWin=2", async () => {
    const { tournamentId, sportId } = await seed({
      sportName: "Badminton", category: "Racquet", scoringType: "sets",
      matchFormat: { scoringType: "sets", totalSets: 3, setsToWin: 2, pointsPerSet: 21 },
    });
    await generateBracket(tournamentId, sportId);

    const m = await DirectKnockoutMatch.findOne({ tournamentId, roundNumber: 1, matchNumber: 1 });

    // The defect: totalSets and scoringType were dropped on save.
    expect(m.matchFormat.totalSets).not.toBeNull();
    expect(m.matchFormat.totalSets).toBeGreaterThanOrEqual(2);
    expect(m.matchFormat.scoringType).toBe("sets");

    // And the value the scoring engine actually acts on. This returned 1 before.
    const fmt = readMatchFormat(m);
    expect(fmt.setsToWin).toBe(2);
    expect(fmt.setsToWin).toBeLessThanOrEqual(fmt.totalSets);
  });

  test("readMatchFormat no longer needs to invent totalSets", async () => {
    const { tournamentId, sportId } = await seed({
      sportName: "Badminton", category: "Racquet", scoringType: "sets",
      matchFormat: { scoringType: "sets", totalSets: 5, setsToWin: 3, pointsPerSet: 21 },
    });
    await generateBracket(tournamentId, sportId);

    const m = await DirectKnockoutMatch.findOne({ tournamentId, roundNumber: 1, matchNumber: 1 });
    const fmt = readMatchFormat(m);

    // Derivation is now a fallback for legacy docs, not the normal path: what
    // is read is exactly what is stored, untouched. (The stored values are the
    // per-round bestOf override, not the tournament default — round 1 of an
    // 8-draw is Bo3 by design, so we compare against the document rather than
    // the tournament config.)
    expect(fmt.totalSets).toBe(m.matchFormat.totalSets);
    expect(fmt.setsToWin).toBe(m.matchFormat.setsToWin);
    expect(fmt.setsToWin).toBeLessThanOrEqual(fmt.totalSets);
  });
});

describe("carrom — board config survives the round trip", () => {
  test("boardsToWin and queenValue persist instead of being dropped", async () => {
    const { tournamentId, sportId } = await seed({
      sportName: "Carrom", category: "Board", scoringType: "board",
      matchFormat: { scoringType: "board", boardsToWin: 3, totalSets: 5, queenValue: 5 },
    });
    await generateBracket(tournamentId, sportId);

    const m = await DirectKnockoutMatch.findOne({ tournamentId, roundNumber: 1, matchNumber: 1 });

    expect(m.matchFormat.scoringType).toBe("board");
    expect(m.matchFormat.boardsToWin).toBe(3);
    expect(m.matchFormat.queenValue).toBe(5);

    // Previously this threw: the stored format had no boardsToWin, so the
    // board branch of validateMatchFormat failed and Carrom matches could not
    // be scored at all.
    expect(() => readMatchFormat(m)).not.toThrow();
    expect(readMatchFormat(m).boardsToWin).toBe(3);
  });
});

describe("per-round bestOf reaches the match document", () => {
  test("the final carries a longer format than round one", async () => {
    const { tournamentId, sportId } = await seed({
      sportName: "Badminton", category: "Racquet", scoringType: "sets",
      matchFormat: { scoringType: "sets", totalSets: 3, setsToWin: 2, pointsPerSet: 21 },
    });
    // Bo3 early rounds, Bo5 semi, Bo7 final — the escalation courtScheduling
    // applies by default.
    await generateBracket(tournamentId, sportId);

    const r1 = await DirectKnockoutMatch.findOne({ tournamentId, roundNumber: 1, matchNumber: 1 });
    const final = await DirectKnockoutMatch.findOne({ tournamentId, round: "final" });

    const r1Fmt = readMatchFormat(r1);
    const finalFmt = readMatchFormat(final);

    // Both were indistinguishable before — every match read back as best-of-1.
    expect(r1Fmt.setsToWin).toBe(2);   // Bo3
    expect(finalFmt.setsToWin).toBe(4); // Bo7
    expect(finalFmt.totalSets).toBeGreaterThan(r1Fmt.totalSets);
  });
});
