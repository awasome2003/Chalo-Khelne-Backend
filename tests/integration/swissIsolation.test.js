"use strict";
/**
 * Swiss isolation.
 *
 * Swiss deliberately lives in its own collection rather than reusing the
 * group-stage `Match` model, because:
 *
 *   • Match.groupId is required — Swiss would have to invent a fake group and
 *     would then appear on the group-stage screens.
 *   • Six controller queries run `Match.find({ tournamentId })` with no group
 *     scoping (qualifier computation, knockout seeding, tournament-wide lists).
 *     Swiss matches would be silently swept into every one of them.
 *
 * These tests assert BOTH halves of that decision:
 *   1. Swiss is invisible to the existing per-model queries.
 *   2. Swiss is visible through the shared MATCH_MODELS registry, so the
 *      finders and leaderboards see it without any of them knowing Swiss exists.
 *
 * If a future change makes Swiss leak into a group-stage or knockout path, the
 * first half fails here rather than surfacing as a wrong points table.
 */
const mongoose = require("mongoose");
const { startTestApp, stopTestApp, clearDatabase } = require("./setup");

const Tournament = require("../../src/modules/tournaments/models/Tournament");
const Sport = require("../../src/modules/catalog/models/Sport");
const Match = require("../../src/modules/tournaments/models/Tournnamentmatch");
const DirectKnockoutMatch = require("../../src/modules/tournaments/models/DirectKnockoutMatch");
const SuperMatch = require("../../src/modules/tournaments/models/SuperMatch");
const SwissMatch = require("../../src/modules/tournaments/models/SwissMatch");
const { createSwissMatch } = require("../../factories/MatchFactory");
const { findMatchById, findMatchesByTournament } = require("../../utils/matchUtils");

beforeAll(async () => { await startTestApp(); });
afterAll(stopTestApp);
beforeEach(clearDatabase);

async function seed() {
  const sport = await Sport.create({ name: "Badminton", category: "Racquet", scoringType: "sets" });
  const tournament = await Tournament.create({
    title: "Swiss Isolation Cup",
    sports: [{
      sportId: sport._id, sportName: "Badminton", tournamentLevel: "unranked",
      // Tournament type is PER SPORT — there is no root-level `type` field.
      type: "swiss",
      categories: [{ name: "Open", fee: 0 }],
      matchFormat: { scoringType: "sets", totalSets: 3, setsToWin: 2, pointsPerSet: 21 },
    }],
  });
  return { tournament, sportId: String(sport._id) };
}

const mkSwiss = (tournament, sportId, over = {}) =>
  createSwissMatch({
    tournament,
    tournamentId: tournament._id,
    sportId,
    swissRound: 1,
    totalRounds: 3,
    matchNumber: 1,
    category: "Open",
    player1: { playerId: null, userName: "Rahul" },
    player2: { playerId: null, userName: "Amit" },
    ...over,
  });

describe("the tournament type accepts swiss", () => {
  test("a swiss tournament saves without touching the other values", async () => {
    const { tournament } = await seed();
    expect(tournament.sports[0].type).toBe("swiss");

    // The pre-existing values still validate — the enum addition is additive.
    for (const type of ["knockout", "group stage", "knockout + group stage"]) {
      const t = await Tournament.create({
        title: `T ${type}`,
        sports: [{ ...tournament.sports[0].toObject(), type }],
      });
      expect(t.sports[0].type).toBe(type);
    }
  });
});

describe("swiss matches are invisible to the other models", () => {
  test("Match.find({ tournamentId }) does not return swiss matches", async () => {
    const { tournament, sportId } = await seed();
    await SwissMatch.insertMany([mkSwiss(tournament, sportId)]);

    // The exact unscoped query shape used by six controllers.
    const groupMatches = await Match.find({ tournamentId: tournament._id });
    expect(groupMatches).toHaveLength(0);
  });

  test("the knockout models do not return swiss matches either", async () => {
    const { tournament, sportId } = await seed();
    await SwissMatch.insertMany([mkSwiss(tournament, sportId)]);

    expect(await DirectKnockoutMatch.countDocuments({ tournamentId: tournament._id })).toBe(0);
    expect(await SuperMatch.countDocuments({ tournamentId: tournament._id })).toBe(0);
  });

  test("swiss lives in its own collection", async () => {
    const { tournament, sportId } = await seed();
    await SwissMatch.insertMany([mkSwiss(tournament, sportId)]);

    expect(SwissMatch.collection.name).not.toBe(Match.collection.name);
    expect(await SwissMatch.countDocuments({ tournamentId: tournament._id })).toBe(1);
  });

  test("swiss needs no fake group — groupId is not part of its shape", () => {
    expect(SwissMatch.schema.path("groupId")).toBeUndefined();
    // Whereas the group-stage model requires one, which is why reuse was unsafe.
    expect(Match.schema.path("groupId").isRequired).toBe(true);
  });
});

describe("swiss IS reachable through the shared registry", () => {
  test("findMatchById resolves a swiss match", async () => {
    const { tournament, sportId } = await seed();
    const [saved] = await SwissMatch.insertMany([mkSwiss(tournament, sportId)]);

    const found = await findMatchById(String(saved._id));
    expect(found).toBeTruthy();
    expect(found.schemaName).toBe("SwissMatch");
    expect(String(found.match._id)).toBe(String(saved._id));
  });

  test("findMatchesByTournament includes swiss matches", async () => {
    const { tournament, sportId } = await seed();
    await SwissMatch.insertMany([
      mkSwiss(tournament, sportId),
      mkSwiss(tournament, sportId, { matchNumber: 2, player1: { playerId: null, userName: "Priya" }, player2: { playerId: null, userName: "Neha" } }),
    ]);

    const all = await findMatchesByTournament(String(tournament._id));
    const swiss = all.filter((m) => m.schemaName === "SwissMatch" || m.kind === "SWISS");
    expect(swiss.length).toBeGreaterThanOrEqual(2);
  });
});

describe("the factory produces a correctly shaped document", () => {
  test("a normal match is scheduled with both players and the frozen format", async () => {
    const { tournament, sportId } = await seed();
    const [m] = await SwissMatch.insertMany([mkSwiss(tournament, sportId)]);

    expect(m.status).toBe("SCHEDULED");
    expect(m.isBye).toBe(false);
    expect(m.player1.userName).toBe("Rahul");
    expect(m.player2.userName).toBe("Amit");
    expect(m.scoringType).toBe("sets");
    expect(m.matchFormat.setsToWin).toBe(2);
    expect(m.matchFormat.totalSets).toBe(3);
    expect(m.category).toBe("Open");
  });

  test("guest entrants with no user account are allowed", async () => {
    const { tournament, sportId } = await seed();
    const [m] = await SwissMatch.insertMany([mkSwiss(tournament, sportId)]);
    // The corporate/Excel case: identified by name, no login.
    expect(m.player1.playerId).toBeNull();
    expect(m.player2.playerId).toBeNull();
  });

  test("a bye is stored as an already-decided match won by the player who sat out", async () => {
    const { tournament, sportId } = await seed();
    const [m] = await SwissMatch.insertMany([
      mkSwiss(tournament, sportId, {
        isBye: true,
        player1: { playerId: null, userName: "Rahul" },
        player2: undefined,
      }),
    ]);

    expect(m.isBye).toBe(true);
    expect(m.status).toBe("COMPLETED");
    expect(m.player2.userName).toBeNull();
    expect(m.result.winner.playerName).toBe("Rahul");
    expect(m.notes).toMatch(/BYE/);
  });

  test("saving a hand-built document is blocked — creation must go through the factory", async () => {
    // Enforcement is a pre("save") hook, not a constructor guard, so the
    // document builds fine and is rejected when it tries to persist.
    const rogue = new SwissMatch({
      tournamentId: new mongoose.Types.ObjectId(),
      sportId: new mongoose.Types.ObjectId(),
      swissRound: 1,
      totalRounds: 3,
      matchNumber: 1,
      player1: { userName: "X" },
    });
    await expect(rogue.save()).rejects.toThrow(/MatchFactory/i);
  });
});
