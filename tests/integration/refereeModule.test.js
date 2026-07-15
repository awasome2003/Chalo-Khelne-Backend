"use strict";
/**
 * Referee / Umpire module — STRICT test suite.
 *
 * Exercises the full authorization + assignment surface the umpire flow relies on:
 *   1. getMatchStage (pure)
 *   2. isUmpireAuthorizedForMatch — all 3 grant paths (match / stage / court) + negatives
 *   3. getMyAuthorizations — matchIds / stages / courts + hasAnyGrant
 *   4. assignUmpireToMatch — team-tie support + guards
 *   5. assignUmpireToCourt — assign / unassign / reassign + validation
 *   6. Court distribution — league ties spread across the court pool
 *
 * Runs on a single-node replica set (generation uses transactions).
 */
const mongoose = require("mongoose");
const { startTxApp, stopTxApp, clearDatabase } = require("./setupReplset");

const Tournament = require("../../src/modules/tournaments/models/Tournament");
const TeamKnockoutMatches = require("../../src/modules/tournaments/models/TeamKnockoutMatches");
const TeamKnockoutTeams = require("../../src/modules/tournaments/models/TeamKnockoutTeams");
const Assignment = require("../../src/modules/tournaments/models/Assignment");
const StaffApplication = require("../../src/modules/social/models/StaffApplication");
const Referee = require("../../src/modules/catalog/models/Referee");
const User = require("../../src/modules/identity/models/User");

const { isUmpireAuthorizedForMatch, getMatchStage } = require("../../utils/umpireAuth");
const refereeController = require("../../controllers/refereeController");
const courtController = require("../../controllers/courtController");
const teamKnockoutController = require("../../controllers/teamKnockoutController");

const OID = () => new mongoose.Types.ObjectId();
function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

async function seedUmpire(name = "Ump") {
  const userId = OID();
  await User.collection.insertOne({ _id: userId, name });
  await Referee.collection.insertOne({ _id: OID(), userId });
  return userId;
}

async function seedTournament({ courts = [] } = {}) {
  const tournamentId = OID();
  const sportId = OID();
  const fmt = { scoringType: "sets", totalSets: 5, setsToWin: 3, totalGames: 1, gamesToWin: 1, pointsToWinGame: 11, marginToWin: 2, deuceRule: true };
  await Tournament.collection.insertOne({
    _id: tournamentId,
    title: "Ref Cup",
    davisCupFormatId: "rapid_rallies_s1",
    lineupMode: "dynamic",
    matchFormat: fmt,
    sports: [{ sportId, sportName: "Table Tennis", davisCupFormatId: "rapid_rallies_s1", matchFormat: fmt }],
    courts: courts.map((c) => ({
      _id: c._id || OID(),
      name: c.name,
      isActive: c.isActive !== false,
      assignedUmpire: c.assignedUmpire || { refereeId: null, name: null },
    })),
  });
  return { tournamentId, sportId };
}

function makeTeam(tournamentId, tag) {
  return {
    _id: OID(), tournamentId, originalBookingId: OID(), teamName: `Team ${tag}`,
    playerPositions: { A: `${tag}1`, B: `${tag}2`, C: null },
    roster: [
      { position: "P1", name: `${tag}1`, gender: "male", role: "captain" },
      { position: "P2", name: `${tag}2`, gender: "male", role: "player" },
      { position: "P3", name: `${tag}3`, gender: "female", role: "player" },
      { position: "P4", name: `${tag}4`, gender: "male", role: "player" },
      { position: "P5", name: `${tag}5`, gender: "male", role: "player" },
    ],
    status: "ACTIVE", matchesWon: 0, matchesLost: 0, setsWon: 0, setsLost: 0, currentRound: 1,
  };
}
const schedule = { matchStartTime: new Date("2026-08-01T10:00:00Z").toISOString(), matchInterval: "30", courtNumber: "1" };

beforeAll(async () => { await startTxApp(); });
afterAll(stopTxApp);
beforeEach(async () => { await clearDatabase(); });

// ───────────────────────────────────────────────────────────────────────────
describe("getMatchStage (pure)", () => {
  test("group match (has groupId) → group-stage", () => {
    expect(getMatchStage({ groupId: OID() })).toBe("group-stage");
  });
  test("non-group match → knockout", () => {
    expect(getMatchStage({})).toBe("knockout");
    expect(getMatchStage(null)).toBe("knockout");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("isUmpireAuthorizedForMatch — negatives & malformed", () => {
  test("missing userId / match / tournamentId → not authorized", async () => {
    expect((await isUmpireAuthorizedForMatch(null, { _id: OID(), tournamentId: OID() })).authorized).toBe(false);
    expect((await isUmpireAuthorizedForMatch(OID(), null)).authorized).toBe(false);
    expect((await isUmpireAuthorizedForMatch(OID(), { _id: OID() })).authorized).toBe(false);
    expect((await isUmpireAuthorizedForMatch(OID(), { tournamentId: OID() })).authorized).toBe(false);
  });

  test("no grant of any kind → not authorized", async () => {
    const { tournamentId } = await seedTournament();
    const out = await isUmpireAuthorizedForMatch(OID(), { _id: OID(), tournamentId, courtNumber: "Table 1" });
    expect(out.authorized).toBe(false);
  });
});

describe("isUmpireAuthorizedForMatch — A. per-match Assignment", () => {
  test("accepted Assignment for THIS match → authorized (match-assignment)", async () => {
    const { tournamentId } = await seedTournament();
    const userId = OID();
    const matchId = OID();
    await Assignment.collection.insertOne({ refereeId: userId, matchId, tournamentId, status: "accepted" });
    const out = await isUmpireAuthorizedForMatch(userId, { _id: matchId, tournamentId });
    expect(out).toMatchObject({ authorized: true, via: "match-assignment" });
  });

  test("PENDING assignment → not authorized", async () => {
    const { tournamentId } = await seedTournament();
    const userId = OID();
    const matchId = OID();
    await Assignment.collection.insertOne({ refereeId: userId, matchId, tournamentId, status: "pending" });
    expect((await isUmpireAuthorizedForMatch(userId, { _id: matchId, tournamentId })).authorized).toBe(false);
  });

  test("assignment for a DIFFERENT match → not authorized", async () => {
    const { tournamentId } = await seedTournament();
    const userId = OID();
    await Assignment.collection.insertOne({ refereeId: userId, matchId: OID(), tournamentId, status: "accepted" });
    expect((await isUmpireAuthorizedForMatch(userId, { _id: OID(), tournamentId })).authorized).toBe(false);
  });
});

describe("isUmpireAuthorizedForMatch — B. stage-level StaffApplication", () => {
  test("accepted app with NO explicit stages → authorized for both knockout & group-stage", async () => {
    const { tournamentId } = await seedTournament();
    const userId = OID();
    await StaffApplication.collection.insertOne({ userId, tournamentId, role: "referee", status: "accepted", stages: [] });
    expect((await isUmpireAuthorizedForMatch(userId, { _id: OID(), tournamentId })).via).toBe("stage-grant"); // knockout
    expect((await isUmpireAuthorizedForMatch(userId, { _id: OID(), tournamentId, groupId: OID() })).authorized).toBe(true); // group
  });

  test("explicit stages=['knockout'] → authorized for knockout, NOT group-stage", async () => {
    const { tournamentId } = await seedTournament();
    const userId = OID();
    await StaffApplication.collection.insertOne({ userId, tournamentId, role: "referee", status: "accepted", stages: ["knockout"] });
    expect((await isUmpireAuthorizedForMatch(userId, { _id: OID(), tournamentId })).authorized).toBe(true);
    expect((await isUmpireAuthorizedForMatch(userId, { _id: OID(), tournamentId, groupId: OID() })).authorized).toBe(false);
  });

  test("PENDING application → not authorized", async () => {
    const { tournamentId } = await seedTournament();
    const userId = OID();
    await StaffApplication.collection.insertOne({ userId, tournamentId, role: "referee", status: "pending", stages: [] });
    expect((await isUmpireAuthorizedForMatch(userId, { _id: OID(), tournamentId })).authorized).toBe(false);
  });
});

describe("isUmpireAuthorizedForMatch — C. court-based", () => {
  test("umpire assigned to the match's court → authorized (court-grant)", async () => {
    const umpireId = OID();
    const { tournamentId } = await seedTournament({ courts: [{ name: "Table 1", assignedUmpire: { refereeId: umpireId, name: "A" } }, { name: "Table 2" }] });
    const out = await isUmpireAuthorizedForMatch(umpireId, { _id: OID(), tournamentId, courtNumber: "Table 1" });
    expect(out).toMatchObject({ authorized: true, via: "court-grant", court: "Table 1" });
  });

  test("different court → not authorized", async () => {
    const umpireId = OID();
    const { tournamentId } = await seedTournament({ courts: [{ name: "Table 1", assignedUmpire: { refereeId: umpireId, name: "A" } }, { name: "Table 2" }] });
    expect((await isUmpireAuthorizedForMatch(umpireId, { _id: OID(), tournamentId, courtNumber: "Table 2" })).authorized).toBe(false);
  });

  test("different user on the assigned court → not authorized", async () => {
    const umpireId = OID();
    const { tournamentId } = await seedTournament({ courts: [{ name: "Table 1", assignedUmpire: { refereeId: umpireId, name: "A" } }] });
    expect((await isUmpireAuthorizedForMatch(OID(), { _id: OID(), tournamentId, courtNumber: "Table 1" })).authorized).toBe(false);
  });

  test("court name match is case-insensitive + whitespace-trimmed", async () => {
    const umpireId = OID();
    const { tournamentId } = await seedTournament({ courts: [{ name: "Table 1", assignedUmpire: { refereeId: umpireId, name: "A" } }] });
    expect((await isUmpireAuthorizedForMatch(umpireId, { _id: OID(), tournamentId, courtNumber: "  table 1 " })).authorized).toBe(true);
  });

  test("court with no assigned umpire → not authorized", async () => {
    const { tournamentId } = await seedTournament({ courts: [{ name: "Table 1" }] });
    expect((await isUmpireAuthorizedForMatch(OID(), { _id: OID(), tournamentId, courtNumber: "Table 1" })).authorized).toBe(false);
  });

  test("courtNumber TBD / BYE / empty → not authorized", async () => {
    const umpireId = OID();
    const { tournamentId } = await seedTournament({ courts: [{ name: "Table 1", assignedUmpire: { refereeId: umpireId, name: "A" } }] });
    for (const cn of ["TBD", "BYE", "", null, undefined]) {
      expect((await isUmpireAuthorizedForMatch(umpireId, { _id: OID(), tournamentId, courtNumber: cn })).authorized).toBe(false);
    }
  });

  test("STRICT: court-scoped umpire denied on another court even WITH an accepted stage app", async () => {
    const umpireId = OID();
    const { tournamentId } = await seedTournament({ courts: [{ name: "Table 1", assignedUmpire: { refereeId: umpireId, name: "A" } }, { name: "Table 2" }] });
    // An accepted app with stages:[] would normally grant ALL stages — court-scoping must suppress it.
    await StaffApplication.collection.insertOne({ userId: umpireId, tournamentId, role: "referee", status: "accepted", stages: [] });

    // Their own court → allowed.
    expect((await isUmpireAuthorizedForMatch(umpireId, { _id: OID(), tournamentId, courtNumber: "Table 1" })).authorized).toBe(true);
    // Another court → DENIED, flagged courtScoped (stage grant suppressed).
    const other = await isUmpireAuthorizedForMatch(umpireId, { _id: OID(), tournamentId, courtNumber: "Table 2" });
    expect(other.authorized).toBe(false);
    expect(other.courtScoped).toBe(true);
    // A match with no court at all → also denied for a court-scoped umpire.
    expect((await isUmpireAuthorizedForMatch(umpireId, { _id: OID(), tournamentId, groupId: OID() })).authorized).toBe(false);
  });

  test("court-scoped umpire CAN still score an explicit per-match assignment on another court", async () => {
    const umpireId = OID();
    const { tournamentId } = await seedTournament({ courts: [{ name: "Table 1", assignedUmpire: { refereeId: umpireId, name: "A" } }, { name: "Table 2" }] });
    const otherMatch = OID();
    await Assignment.collection.insertOne({ refereeId: umpireId, matchId: otherMatch, tournamentId, status: "accepted" });
    const out = await isUmpireAuthorizedForMatch(umpireId, { _id: otherMatch, tournamentId, courtNumber: "Table 2" });
    expect(out).toMatchObject({ authorized: true, via: "match-assignment" });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("getMyAuthorizations", () => {
  const call = (userId, tournamentId) => {
    const res = mockRes();
    return refereeController.getMyAuthorizations({ params: { userId: userId.toString(), tournamentId: tournamentId.toString() } }, res).then(() => res);
  };

  test("invalid ids → 400", async () => {
    const res = mockRes();
    await refereeController.getMyAuthorizations({ params: { userId: "bad", tournamentId: "bad" } }, res);
    expect(res.statusCode).toBe(400);
  });

  test("non-court umpire: returns stages + accepted matchIds (pending excluded)", async () => {
    const umpireId = OID();
    const { tournamentId } = await seedTournament(); // no courts → not court-scoped
    const acceptedMatch = OID();
    await Assignment.collection.insertMany([
      { refereeId: umpireId, matchId: acceptedMatch, tournamentId, status: "accepted" },
      { refereeId: umpireId, matchId: OID(), tournamentId, status: "pending" }, // excluded
    ]);
    await StaffApplication.collection.insertOne({ userId: umpireId, tournamentId, role: "referee", status: "accepted", stages: ["knockout"] });

    const res = await call(umpireId, tournamentId);
    expect(res.statusCode).toBe(200);
    expect(res.body.matchIds).toEqual([acceptedMatch.toString()]); // pending excluded
    expect(res.body.stages).toEqual(["knockout"]);
    expect(res.body.courts).toEqual([]);
    expect(res.body.hasAnyGrant).toBe(true);
  });

  test("court-scoped umpire: stages SUPPRESSED, courts returned (strict)", async () => {
    const umpireId = OID();
    const { tournamentId } = await seedTournament({ courts: [{ name: "Table 1", assignedUmpire: { refereeId: umpireId, name: "A" } }, { name: "Table 2" }] });
    // Even with an accepted app that would grant all stages, court-scoping wins.
    await StaffApplication.collection.insertOne({ userId: umpireId, tournamentId, role: "referee", status: "accepted", stages: [] });

    const res = await call(umpireId, tournamentId);
    expect(res.body.courts).toEqual(["Table 1"]); // only their court
    expect(res.body.stages).toEqual([]); // stage grant suppressed
    expect(res.body.stagesSource).toBe("court-scoped");
    expect(res.body.hasAnyGrant).toBe(true);
  });

  test("no grants → hasAnyGrant false, empty arrays", async () => {
    const { tournamentId } = await seedTournament({ courts: [{ name: "Table 1" }] });
    const res = await call(OID(), tournamentId);
    expect(res.body.hasAnyGrant).toBe(false);
    expect(res.body.matchIds).toEqual([]);
    expect(res.body.courts).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("assignUmpireToCourt (courtController)", () => {
  const call = (tournamentId, courtId, body) => {
    const res = mockRes();
    return courtController.assignUmpireToCourt({ params: { tournamentId: tournamentId.toString(), courtId: courtId.toString() }, body }, res).then(() => res);
  };

  test("assign → court.assignedUmpire set; reassign overwrites; unassign clears", async () => {
    const ump1 = await seedUmpire("Ump One");
    const ump2 = await seedUmpire("Ump Two");
    const courtId = OID();
    const { tournamentId } = await seedTournament({ courts: [{ _id: courtId, name: "Table 1" }] });

    let res = await call(tournamentId, courtId, { refereeUserId: ump1.toString() });
    expect(res.statusCode).toBe(200);
    let t = await Tournament.findById(tournamentId).lean();
    expect(String(t.courts[0].assignedUmpire.refereeId)).toBe(String(ump1));
    expect(t.courts[0].assignedUmpire.name).toBe("Ump One");

    // reassign (one umpire per court — overwrite)
    res = await call(tournamentId, courtId, { refereeUserId: ump2.toString() });
    expect(res.statusCode).toBe(200);
    t = await Tournament.findById(tournamentId).lean();
    expect(String(t.courts[0].assignedUmpire.refereeId)).toBe(String(ump2));

    // unassign
    res = await call(tournamentId, courtId, { refereeUserId: null });
    expect(res.statusCode).toBe(200);
    t = await Tournament.findById(tournamentId).lean();
    expect(t.courts[0].assignedUmpire.refereeId).toBeFalsy();
  });

  test("invalid courtId → 400", async () => {
    const { tournamentId } = await seedTournament({ courts: [{ name: "Table 1" }] });
    const res = mockRes();
    await courtController.assignUmpireToCourt({ params: { tournamentId: tournamentId.toString(), courtId: "not-an-id" }, body: {} }, res);
    expect(res.statusCode).toBe(400);
  });

  test("court not found → 404", async () => {
    const { tournamentId } = await seedTournament({ courts: [{ name: "Table 1" }] });
    const res = await call(tournamentId, OID(), { refereeUserId: (await seedUmpire()).toString() });
    expect(res.statusCode).toBe(404);
  });

  test("tournament not found → 404", async () => {
    const res = await call(OID(), OID(), {});
    expect(res.statusCode).toBe(404);
  });

  test("refereeUserId without a Referee profile → 404", async () => {
    const courtId = OID();
    const { tournamentId } = await seedTournament({ courts: [{ _id: courtId, name: "Table 1" }] });
    const userNoProfile = OID();
    await User.collection.insertOne({ _id: userNoProfile, name: "No Profile" });
    const res = await call(tournamentId, courtId, { refereeUserId: userNoProfile.toString() });
    expect(res.statusCode).toBe(404);
  });

  test("invalid refereeUserId → 400", async () => {
    const courtId = OID();
    const { tournamentId } = await seedTournament({ courts: [{ _id: courtId, name: "Table 1" }] });
    const res = await call(tournamentId, courtId, { refereeUserId: "nope" });
    expect(res.statusCode).toBe(400);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("assignUmpireToMatch (team-tie support + guards)", () => {
  async function seedTeamMatch(tournamentId, { status = "SCHEDULED", referee = null } = {}) {
    const matchId = OID();
    await TeamKnockoutMatches.collection.insertOne({
      _id: matchId, tournamentId, round: 0, team1Id: OID(), team2Id: OID(),
      status, courtNumber: "Table 1", sets: [], setsWon: { home: 0, away: 0 }, referee,
    });
    return matchId;
  }
  const call = (matchId, body) => {
    const res = mockRes();
    return refereeController.assignUmpireToMatch({ params: { matchId: matchId.toString() }, body, user: {}, userRole: "Manager" }, res).then(() => res);
  };

  test("assigns to a TeamKnockoutMatches tie → Assignment created + match.referee set", async () => {
    const umpire = await seedUmpire("Court Ump");
    const { tournamentId } = await seedTournament();
    const matchId = await seedTeamMatch(tournamentId);
    const res = await call(matchId, { refereeUserId: umpire.toString() });
    expect(res.statusCode).toBe(201);
    const m = await TeamKnockoutMatches.findById(matchId).lean();
    expect(String(m.referee.refereeId)).toBe(String(umpire));
    const asg = await Assignment.findOne({ matchId, refereeId: umpire }).lean();
    expect(asg).toBeTruthy();
    expect(asg.status).toBe("pending");
  });

  test("rejects when the tie is already completed", async () => {
    const umpire = await seedUmpire();
    const { tournamentId } = await seedTournament();
    const matchId = await seedTeamMatch(tournamentId, { status: "COMPLETED" });
    const res = await call(matchId, { refereeUserId: umpire.toString() });
    expect(res.statusCode).toBe(400);
  });

  test("rejects when the tie already has an umpire", async () => {
    const umpire = await seedUmpire();
    const { tournamentId } = await seedTournament();
    const matchId = await seedTeamMatch(tournamentId, { referee: { refereeId: OID(), name: "Existing" } });
    const res = await call(matchId, { refereeUserId: umpire.toString() });
    expect(res.statusCode).toBe(400);
  });

  test("rejects umpire without a Referee profile", async () => {
    const { tournamentId } = await seedTournament();
    const matchId = await seedTeamMatch(tournamentId);
    const userNoProfile = OID();
    await User.collection.insertOne({ _id: userNoProfile, name: "No Profile" });
    const res = await call(matchId, { refereeUserId: userNoProfile.toString() });
    expect(res.statusCode).toBe(404);
  });

  test("rejects invalid refereeUserId", async () => {
    const { tournamentId } = await seedTournament();
    const matchId = await seedTeamMatch(tournamentId);
    const res = await call(matchId, { refereeUserId: "bad" });
    expect(res.statusCode).toBe(400);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("league court distribution", () => {
  const generate = (tournamentId, scheduleDetails = schedule) => {
    const res = mockRes();
    return teamKnockoutController.generateRoundRobinMatches({ body: { tournamentId: tournamentId.toString(), scheduleDetails } }, res).then(() => res);
  };

  test("distributes ties across scheduleDetails.courtNames (subset overrides active courts)", async () => {
    const { tournamentId } = await seedTournament({ courts: [{ name: "Table 1" }, { name: "Table 2" }, { name: "Table 3" }] });
    await TeamKnockoutTeams.collection.insertMany([makeTeam(tournamentId, "A"), makeTeam(tournamentId, "B"), makeTeam(tournamentId, "C"), makeTeam(tournamentId, "D")]);
    const res = await generate(tournamentId, { ...schedule, courtNames: ["Table 1", "Table 2"] }); // reserve Table 3 for knockout
    expect(res.statusCode).toBe(201);
    const matches = await TeamKnockoutMatches.find({ tournamentId }).lean();
    expect([...new Set(matches.map((m) => m.courtNumber))].sort()).toEqual(["Table 1", "Table 2"]); // Table 3 NOT used
  });

  test("falls back to tournament active courts when no courtNames given", async () => {
    const { tournamentId } = await seedTournament({ courts: [{ name: "Table 1" }, { name: "Table 2", isActive: false }] });
    await TeamKnockoutTeams.collection.insertMany([makeTeam(tournamentId, "A"), makeTeam(tournamentId, "B"), makeTeam(tournamentId, "C")]);
    const res = await generate(tournamentId);
    expect(res.statusCode).toBe(201);
    const matches = await TeamKnockoutMatches.find({ tournamentId }).lean();
    expect([...new Set(matches.map((m) => m.courtNumber))]).toEqual(["Table 1"]); // inactive court skipped
  });

  test("falls back to the legacy single courtNumber when tournament has no courts", async () => {
    const { tournamentId } = await seedTournament({ courts: [] });
    await TeamKnockoutTeams.collection.insertMany([makeTeam(tournamentId, "A"), makeTeam(tournamentId, "B")]);
    const res = await generate(tournamentId, { ...schedule, courtNumber: "Court 7" });
    expect(res.statusCode).toBe(201);
    const matches = await TeamKnockoutMatches.find({ tournamentId }).lean();
    expect(matches.every((m) => m.courtNumber === "Court 7")).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("distributeMatchesToCourts (courtController)", () => {
  const call = (tournamentId, body = {}) => {
    const res = mockRes();
    return courtController.distributeMatchesToCourts({ params: { tournamentId: tournamentId.toString() }, body }, res).then(() => res);
  };
  const seedTies = (tournamentId, rows) =>
    TeamKnockoutMatches.collection.insertMany(
      rows.map((r, i) => ({ _id: OID(), tournamentId, roundNumber: 0, matchNumber: i + 1, courtNumber: r.court, status: r.status || "pending" }))
    );

  test("round-robins legacy-labelled ties across active courts", async () => {
    const { tournamentId } = await seedTournament({ courts: [{ name: "Table 1" }, { name: "Table 2" }, { name: "Table 3" }] });
    await seedTies(tournamentId, [{ court: "1" }, { court: "1" }, { court: "1" }, { court: "1" }, { court: "1" }, { court: "1" }]);
    const res = await call(tournamentId);
    expect(res.statusCode).toBe(200);
    expect(res.body.totalUpdated).toBe(6);
    const matches = await TeamKnockoutMatches.find({ tournamentId }).sort({ matchNumber: 1 }).lean();
    // 6 ties over 3 courts → 2 each, in matchNumber order.
    expect(matches.map((m) => m.courtNumber)).toEqual(["Table 1", "Table 2", "Table 3", "Table 1", "Table 2", "Table 3"]);
  });

  test("skips completed matches by default (preserves finished results)", async () => {
    const { tournamentId } = await seedTournament({ courts: [{ name: "Table 1" }, { name: "Table 2" }] });
    await seedTies(tournamentId, [{ court: "1", status: "completed" }, { court: "1" }, { court: "1" }]);
    const res = await call(tournamentId);
    expect(res.body.totalUpdated).toBe(2); // completed one untouched
    const matches = await TeamKnockoutMatches.find({ tournamentId }).sort({ matchNumber: 1 }).lean();
    expect(matches[0].courtNumber).toBe("1"); // completed keeps its label
    expect(matches[1].courtNumber).toBe("Table 1");
    expect(matches[2].courtNumber).toBe("Table 2");
  });

  test("onlyUnassigned leaves ties already on a valid active court untouched", async () => {
    const { tournamentId } = await seedTournament({ courts: [{ name: "Table 1" }, { name: "Table 2" }] });
    await seedTies(tournamentId, [{ court: "Table 2" }, { court: "unknown" }]);
    const res = await call(tournamentId, { onlyUnassigned: true });
    expect(res.body.totalUpdated).toBe(1); // only the "unknown" one moves
    const matches = await TeamKnockoutMatches.find({ tournamentId }).sort({ matchNumber: 1 }).lean();
    expect(matches[0].courtNumber).toBe("Table 2"); // already valid → untouched
    expect(["Table 1", "Table 2"]).toContain(matches[1].courtNumber);
  });

  test("400 when there are no active courts", async () => {
    const { tournamentId } = await seedTournament({ courts: [{ name: "Table 1", isActive: false }] });
    await seedTies(tournamentId, [{ court: "1" }]);
    const res = await call(tournamentId);
    expect(res.statusCode).toBe(400);
  });
});
