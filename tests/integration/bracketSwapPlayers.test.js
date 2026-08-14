"use strict";
/**
 * Drag-and-drop player swap on a knockout bracket.
 *
 * The manager could already EDIT a player's name in a generated bracket
 * (PUT .../player-name), which rewrites `playerName` and nothing else. That is
 * the right shape for fixing a typo and the wrong shape for a swap: progression,
 * standings and result attribution all key on `playerId`, so a name-only swap
 * would show one player in the slot while the engine still advanced the other.
 *
 * These tests pin the properties that make the swap safe:
 *   • the whole slot moves — playerId travels with playerName;
 *   • both matches must be in the SAME tournament (the param guard only
 *     authorises the source);
 *   • a live or completed match cannot have players moved out of it;
 *   • a cross-match swap is atomic.
 */

const request = require("supertest");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { startTxApp, stopTxApp, clearDatabase } = require("./setupReplset");

const Tournament = require("../../src/modules/tournaments/models/Tournament");
const Sport = require("../../src/modules/catalog/models/Sport");
const DirectKnockoutMatch = require("../../src/modules/tournaments/models/DirectKnockoutMatch");
const Role = require("../../src/modules/identity/models/Role");
const Permission = require("../../src/modules/identity/models/Permission");
const { Manager } = require("../../src/modules/identity/models/ClubManager");

let app;

beforeAll(async () => {
  app = await startTxApp();
});
afterAll(stopTxApp);
beforeEach(clearDatabase);

function mgrToken(id) {
  return jwt.sign({ id: String(id), role: "Manager" }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

async function seedRbac() {
  const p = await Permission.create({
    key: "tournament:manage",
    name: "Manage tournament",
    module: "tournament",
    action: "manage",
  });
  await Role.create({ name: "Manager", slug: "manager", authorityLevel: 2, permissions: [p._id] });
}

async function makeTournament(manager, clubId, title = "Bracket Cup") {
  const sport = await Sport.create({
    name: `TT-${Math.random().toString(36).slice(2, 8)}`,
    category: "Racquet",
    scoringType: "sets",
  });
  return Tournament.create({
    title,
    startDate: new Date("2030-05-01"),
    endDate: new Date("2030-05-02"),
    managerId: [manager._id],
    clubId,
    sports: [
      {
        sportId: sport._id,
        sportName: sport.name,
        tournamentLevel: "unranked",
        categories: [{ name: "Open", fee: 0 }],
      },
    ],
  });
}

async function makeMatch(tournament, n, players, status = "SCHEDULED") {
  return DirectKnockoutMatch.create({
    matchId: `DK-${tournament._id}-R1-M${n}`,
    tournamentId: tournament._id,
    clubId: tournament.clubId,
    sportId: tournament.sports[0].sportId,
    round: "round-of-16",
    roundNumber: 1,
    matchNumber: n,
    courtNumber: String(n),
    matchStartTime: new Date("2030-05-01T09:00:00Z"),
    status,
    // Match schemas refuse direct instantiation (MatchFactory enforcement).
    // These fixtures stand in for an already-generated bracket; the swap logic
    // is what is under test, not bracket creation.
    _createdViaFactory: true,
    player1: players[0],
    player2: players[1],
  });
}

async function seed() {
  await seedRbac();
  const clubId = new mongoose.Types.ObjectId();
  const manager = await Manager.create({
    name: "Bracket Manager",
    email: `bm-${Date.now()}@test.local`,
    password: "x",
    mobile: "9700000000",
    clubId,
  });
  const tournament = await makeTournament(manager, clubId);

  const alice = new mongoose.Types.ObjectId();
  const bob = new mongoose.Types.ObjectId();
  const cara = new mongoose.Types.ObjectId();
  const dan = new mongoose.Types.ObjectId();

  const m1 = await makeMatch(tournament, 1, [
    { playerId: alice, playerName: "Alice" },
    { playerId: bob, playerName: "Bob" },
  ]);
  const m2 = await makeMatch(tournament, 2, [
    { playerId: cara, playerName: "Cara" },
    { playerId: dan, playerName: "Dan" },
  ]);

  return { manager, tournament, m1, m2, ids: { alice, bob, cara, dan }, clubId };
}

function swap(manager, matchId, body) {
  return request(app)
    .put(`/api/tournaments/direct-knockout/matches/${matchId}/swap-player`)
    .set("Authorization", `Bearer ${mgrToken(manager._id)}`)
    .send(body);
}

describe("identity moves with the name", () => {
  test("swapping within one match moves playerId, not just playerName", async () => {
    const { manager, m1, ids } = await seed();

    const res = await swap(manager, m1.matchId, {
      fromSlot: "player1",
      toMatchId: m1.matchId,
      toSlot: "player2",
    });
    expect(res.status).toBe(200);

    const after = await DirectKnockoutMatch.findById(m1._id).lean();
    expect(after.player1.playerName).toBe("Bob");
    expect(after.player2.playerName).toBe("Alice");
    // The point of the whole endpoint: identity followed the name.
    expect(String(after.player1.playerId)).toBe(String(ids.bob));
    expect(String(after.player2.playerId)).toBe(String(ids.alice));
  });

  test("swapping across two matches moves both slots", async () => {
    const { manager, m1, m2, ids } = await seed();

    const res = await swap(manager, m1.matchId, {
      fromSlot: "player1",
      toMatchId: m2.matchId,
      toSlot: "player2",
    });
    expect(res.status).toBe(200);

    const a = await DirectKnockoutMatch.findById(m1._id).lean();
    const b = await DirectKnockoutMatch.findById(m2._id).lean();

    expect(a.player1.playerName).toBe("Dan");
    expect(String(a.player1.playerId)).toBe(String(ids.dan));
    expect(b.player2.playerName).toBe("Alice");
    expect(String(b.player2.playerId)).toBe(String(ids.alice));

    // Untouched slots stay put.
    expect(a.player2.playerName).toBe("Bob");
    expect(b.player1.playerName).toBe("Cara");
  });

  test("dropping onto an empty slot moves the player and leaves TBD behind", async () => {
    const { manager, tournament, m1, ids } = await seed();
    const empty = await makeMatch(tournament, 3, [
      { playerName: "TBD" },
      { playerName: "TBD" },
    ]);

    const res = await swap(manager, m1.matchId, {
      fromSlot: "player1",
      toMatchId: empty.matchId,
      toSlot: "player1",
    });
    expect(res.status).toBe(200);

    const src = await DirectKnockoutMatch.findById(m1._id).lean();
    const dst = await DirectKnockoutMatch.findById(empty._id).lean();
    expect(dst.player1.playerName).toBe("Alice");
    expect(String(dst.player1.playerId)).toBe(String(ids.alice));
    expect(src.player1.playerName).toBe("TBD");
    expect(src.player1.playerId).toBeUndefined();
  });

  test("no player is duplicated or lost across a swap", async () => {
    const { manager, m1, m2 } = await seed();
    await swap(manager, m1.matchId, {
      fromSlot: "player2",
      toMatchId: m2.matchId,
      toSlot: "player1",
    });

    const all = await DirectKnockoutMatch.find({}).lean();
    const names = all
      .flatMap((m) => [m.player1?.playerName, m.player2?.playerName])
      .filter(Boolean)
      .sort();
    expect(names).toEqual(["Alice", "Bob", "Cara", "Dan"]);
  });
});

describe("guards", () => {
  test("refuses to move players out of a COMPLETED match", async () => {
    const { manager, tournament, m1 } = await seed();
    const done = await makeMatch(
      tournament,
      4,
      [{ playerName: "Eve" }, { playerName: "Frank" }],
      "COMPLETED"
    );

    const res = await swap(manager, m1.matchId, {
      fromSlot: "player1",
      toMatchId: done.matchId,
      toSlot: "player1",
    });
    expect(res.status).toBe(409);
    expect(res.body.status).toBe("COMPLETED");

    // Nothing moved.
    const after = await DirectKnockoutMatch.findById(m1._id).lean();
    expect(after.player1.playerName).toBe("Alice");
  });

  test("refuses to move players out of an IN_PROGRESS match", async () => {
    const { manager, tournament, m1 } = await seed();
    const live = await makeMatch(
      tournament,
      5,
      [{ playerName: "Gina" }, { playerName: "Hank" }],
      "IN_PROGRESS"
    );

    const res = await swap(manager, live.matchId, {
      fromSlot: "player1",
      toMatchId: m1.matchId,
      toSlot: "player1",
    });
    expect(res.status).toBe(409);
  });

  test("refuses a swap into another tournament", async () => {
    const { manager, m1, clubId } = await seed();
    // A second tournament the SAME manager runs — the param guard would pass,
    // so only the explicit same-tournament check stops this.
    const other = await makeTournament(manager, clubId, "Other Cup");
    const foreign = await makeMatch(other, 1, [
      { playerName: "Ivan" },
      { playerName: "Jane" },
    ]);

    const res = await swap(manager, m1.matchId, {
      fromSlot: "player1",
      toMatchId: foreign.matchId,
      toSlot: "player1",
    });
    expect(res.status).toBe(403);

    const a = await DirectKnockoutMatch.findById(m1._id).lean();
    const b = await DirectKnockoutMatch.findById(foreign._id).lean();
    expect(a.player1.playerName).toBe("Alice");
    expect(b.player1.playerName).toBe("Ivan");
  });

  test("rejects an invalid slot name", async () => {
    const { manager, m1 } = await seed();
    const res = await swap(manager, m1.matchId, {
      fromSlot: "player3",
      toMatchId: m1.matchId,
      toSlot: "player1",
    });
    expect(res.status).toBe(400);
  });

  test("rejects a no-op swap onto itself", async () => {
    const { manager, m1 } = await seed();
    const res = await swap(manager, m1.matchId, {
      fromSlot: "player1",
      toMatchId: m1.matchId,
      toSlot: "player1",
    });
    expect(res.status).toBe(400);
  });

  test("404s on an unknown target match", async () => {
    const { manager, m1 } = await seed();
    const res = await swap(manager, m1.matchId, {
      fromSlot: "player1",
      toMatchId: `DK-${new mongoose.Types.ObjectId()}-R1-M9`,
      toSlot: "player1",
    });
    expect(res.status).toBe(404);
  });

  test("an anonymous caller cannot swap", async () => {
    const { m1 } = await seed();
    const res = await request(app)
      .put(`/api/tournaments/direct-knockout/matches/${m1.matchId}/swap-player`)
      .send({ fromSlot: "player1", toMatchId: m1.matchId, toSlot: "player2" });
    expect([401, 403]).toContain(res.status);

    const after = await DirectKnockoutMatch.findById(m1._id).lean();
    expect(after.player1.playerName).toBe("Alice");
  });
});
