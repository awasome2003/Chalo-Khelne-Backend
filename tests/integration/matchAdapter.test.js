"use strict";
/**
 * Phase 2 — match-adapter unification (Path A).
 *
 * Proves the SINGLE adapter (utils/matchUtils) sees and normalizes ALL six match
 * types — including Semifinals, which the registry previously omitted. Docs are
 * inserted raw (collection.insertOne bypasses the MatchFactory save-enforcement
 * hook) carrying only the fields the adapter keys on.
 */
const mongoose = require("mongoose");
const { startTestApp, stopTestApp, clearDatabase } = require("./setup");
const {
  MATCH_MODELS,
  MATCH_KINDS,
  findMatchById,
  findMatchesByTournament,
  getMatchKind,
  getWinner,
  getStatus,
} = require("../../utils/matchUtils");

const Match = require("../../src/modules/tournaments/models/Tournnamentmatch");
const DirectKnockoutMatch = require("../../src/modules/tournaments/models/DirectKnockoutMatch");
const SuperMatch = require("../../src/modules/tournaments/models/SuperMatch");
const TeamKnockoutMatch = require("../../src/modules/tournaments/models/TeamKnockoutMatches");
const KnockoutMatch = require("../../src/modules/tournaments/models/KnockoutMatch");
const Semifinals = require("../../src/modules/tournaments/models/semifinal");

const tournamentId = new mongoose.Types.ObjectId();

// One raw doc per type — only the fields the adapter uses to identify/normalize.
const ids = {};
async function seedAllTypes() {
  ids.GROUP_STAGE = new mongoose.Types.ObjectId();
  ids.DIRECT_KNOCKOUT = new mongoose.Types.ObjectId();
  ids.SUPER = new mongoose.Types.ObjectId();
  ids.TEAM_KNOCKOUT = new mongoose.Types.ObjectId();
  ids.KNOCKOUT = new mongoose.Types.ObjectId();
  ids.SEMIFINAL = new mongoose.Types.ObjectId();

  await Match.collection.insertOne({
    _id: ids.GROUP_STAGE, tournamentId, groupId: new mongoose.Types.ObjectId(),
    status: "COMPLETED", result: { winner: { playerId: new mongoose.Types.ObjectId(), playerName: "G" } },
  });
  await DirectKnockoutMatch.collection.insertOne({
    _id: ids.DIRECT_KNOCKOUT, tournamentId, mode: "direct-knockout",
    status: "SCHEDULED", result: { winner: { playerId: new mongoose.Types.ObjectId(), playerName: "D" } },
  });
  await SuperMatch.collection.insertOne({
    _id: ids.SUPER, tournamentId, loser: { playerName: "L" },
    status: "IN_PROGRESS", winner: { playerId: new mongoose.Types.ObjectId(), playerName: "S" },
  });
  await TeamKnockoutMatch.collection.insertOne({
    _id: ids.TEAM_KNOCKOUT, tournamentId, matchWinner: "home",
    status: "COMPLETED", winnerId: new mongoose.Types.ObjectId(),
  });
  await KnockoutMatch.collection.insertOne({
    _id: ids.KNOCKOUT, tournamentId, nextMatch: { position: "player1" },
    status: "SCHEDULED", winner: { playerId: new mongoose.Types.ObjectId(), playerName: "K" },
  });
  await Semifinals.collection.insertOne({
    _id: ids.SEMIFINAL, tournamentId, matchStage: "semifinal",
    teams: [{ name: "A" }, { name: "B" }], status: "COMPLETED", winner: "A",
  });
}

beforeAll(async () => {
  await startTestApp();
});
afterAll(stopTestApp);

beforeEach(async () => {
  await clearDatabase();
  await seedAllTypes();
});

// Deliberately exhaustive: adding a match model must fail here until it is
// acknowledged, because a kind missing from the registry is invisible to every
// finder and leaderboard — the exact bug that once hid Semifinals.
// SWISS joined when the Swiss-system format was added (own collection, so the
// group-stage queries cannot pick it up; the registry is how it stays findable).
test("registry covers all 7 match kinds (Semifinals and Swiss included)", () => {
  const kinds = MATCH_MODELS.map((m) => m.kind).sort();
  expect(kinds).toEqual(
    [
      MATCH_KINDS.DIRECT_KNOCKOUT,
      MATCH_KINDS.GROUP_STAGE,
      MATCH_KINDS.KNOCKOUT,
      MATCH_KINDS.SEMIFINAL,
      MATCH_KINDS.SUPER,
      MATCH_KINDS.TEAM_KNOCKOUT,
      MATCH_KINDS.SWISS,
    ].sort()
  );
});

test("findMatchById resolves every type — including Semifinals (the fix)", async () => {
  for (const kind of Object.keys(ids)) {
    const found = await findMatchById(ids[kind]);
    expect(found).toBeTruthy();
    expect(getMatchKind(found.match)).toBe(kind);
  }
});

test("findMatchesByTournament returns ALL types for one tournament", async () => {
  const results = await findMatchesByTournament(tournamentId);
  expect(results).toHaveLength(6);
  const kinds = results.map((r) => getMatchKind(r.match)).sort();
  expect(new Set(kinds).size).toBe(6); // one of each kind
});

test("getWinner normalizes every shape (object, winnerId, and Semifinals String)", async () => {
  const group = await findMatchById(ids.GROUP_STAGE);
  expect(getWinner(group.match).playerName).toBe("G"); // result.winner object

  const team = await findMatchById(ids.TEAM_KNOCKOUT);
  expect(getWinner(team.match).isTeam).toBe(true); // winnerId ObjectId

  const semi = await findMatchById(ids.SEMIFINAL);
  expect(getWinner(semi.match)).toEqual({ playerId: null, playerName: "A", isTeam: true }); // String winner

  const sup = await findMatchById(ids.SUPER);
  expect(getStatus(sup.match)).toBe("IN_PROGRESS");
});
