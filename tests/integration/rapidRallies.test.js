"use strict";
/**
 * Rapid Rallies S1 — DB-bound flow (controller-direct, on a replica set so the
 * transactions in generateRoundRobinMatches / completeGame run for real).
 *
 * Covers: 5-slot league generation, roster validation, dynamic captain picks
 * (valid + rejected), playAllSets completion (no dead rubbers), league
 * no-eliminate, and standings.
 */
const mongoose = require("mongoose");
const { startTxApp, stopTxApp, clearDatabase } = require("./setupReplset");
const controller = require("../../controllers/teamKnockoutController");

const Tournament = require("../../src/modules/tournaments/models/Tournament");
const TeamKnockoutTeams = require("../../src/modules/tournaments/models/TeamKnockoutTeams");
const TeamKnockoutMatches = require("../../src/modules/tournaments/models/TeamKnockoutMatches");

const OID = () => new mongoose.Types.ObjectId();

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

function makeTeam(tournamentId, tag, { p3female = true } = {}) {
  return {
    _id: OID(),
    tournamentId,
    originalBookingId: OID(),
    teamName: `Team ${tag}`,
    playerPositions: { A: `${tag}1`, B: `${tag}2`, C: null },
    roster: [
      { position: "P1", name: `${tag}1`, gender: "male", role: "captain" },
      { position: "P2", name: `${tag}2`, gender: "male", role: "player" },
      { position: "P3", name: `${tag}3`, gender: p3female ? "female" : "male", role: "player" },
      { position: "P4", name: `${tag}4`, gender: "male", role: "player" },
      { position: "P5", name: `${tag}5`, gender: "male", role: "player" },
    ],
    status: "ACTIVE",
    matchesWon: 0, matchesLost: 0, setsWon: 0, setsLost: 0, currentRound: 1,
  };
}

async function seedTournament() {
  const tournamentId = OID();
  const sportId = OID();
  const fmt = { scoringType: "sets", totalSets: 5, setsToWin: 3, totalGames: 1, gamesToWin: 1, pointsToWinGame: 11, marginToWin: 2, deuceRule: true };
  await Tournament.collection.insertOne({
    _id: tournamentId,
    title: "Rapid Rallies Cup",
    davisCupFormatId: "rapid_rallies_s1",
    lineupMode: "dynamic",
    matchFormat: fmt,
    sports: [{ sportId, sportName: "Table Tennis", davisCupFormatId: "rapid_rallies_s1", matchFormat: fmt }],
  });
  return { tournamentId, sportId };
}

const schedule = { matchStartTime: new Date("2026-08-01T10:00:00Z").toISOString(), matchInterval: "30", courtNumber: "1" };

let app;
beforeAll(async () => { app = await startTxApp(); });
afterAll(stopTxApp);
beforeEach(async () => { await clearDatabase(); });

describe("generateRoundRobinMatches — Rapid Rallies 5-slot", () => {
  test("builds one tie of 5 rubbers with cross-seed + female rubber + rrSelections", async () => {
    const { tournamentId } = await seedTournament();
    await TeamKnockoutTeams.collection.insertMany([makeTeam(tournamentId, "A"), makeTeam(tournamentId, "B")]);

    const res = mockRes();
    await controller.generateRoundRobinMatches({ body: { tournamentId: tournamentId.toString(), scheduleDetails: schedule } }, res);
    expect(res.statusCode).toBe(201);

    const matches = await TeamKnockoutMatches.find({ tournamentId }).lean();
    expect(matches).toHaveLength(1);
    const m = matches[0];
    expect(m.formatId).toBe("rapid_rallies_s1");
    expect(m.sets).toHaveLength(5);
    // Empty initial selections are minimized away by Mongoose (minimize:true);
    // the pick endpoint defaults them. Either absent or empty is correct.
    expect(m.rrSelections == null || Object.keys(m.rrSelections).length === 0).toBe(true);
    // Rubber 1: home P1 vs away P2 (cross-seed)
    expect(m.sets[0].homePlayer).toBe("A1");
    expect(m.sets[0].awayPlayer).toBe("B2");
    // Rubber 3: female P3 vs P3
    expect(m.sets[2].homePlayer).toBe("A3");
    expect(m.sets[2].awayPlayer).toBe("B3");
    // gameRules frozen from tournament
    expect(m.gameRules.gamesToWin).toBe(1);
    expect(m.gameRules.pointsToWinGame).toBe(11);
  });

  test("rejects generation when a team's P3 is not female", async () => {
    const { tournamentId } = await seedTournament();
    await TeamKnockoutTeams.collection.insertMany([
      makeTeam(tournamentId, "A"),
      makeTeam(tournamentId, "B", { p3female: false }),
    ]);
    const res = mockRes();
    await controller.generateRoundRobinMatches({ body: { tournamentId: tournamentId.toString(), scheduleDetails: schedule } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/not ready for Rapid Rallies/i);
    expect(await TeamKnockoutMatches.countDocuments({ tournamentId })).toBe(0);
  });
});

describe("registerRapidRalliesTeam — self-contained roster registration", () => {
  const players = [
    { name: "Al", gender: "male" }, { name: "Bo", gender: "male" },
    { name: "Cy", gender: "female" }, { name: "Di", gender: "male" }, { name: "Ez", gender: "male" },
  ];

  test("registers a 5-slot roster (P1..P5) with gender", async () => {
    const { tournamentId } = await seedTournament();
    const res = mockRes();
    await controller.registerRapidRalliesTeam({ body: { tournamentId: tournamentId.toString(), teamName: "Falcons", players } }, res);
    expect(res.statusCode).toBe(201);
    const team = await TeamKnockoutTeams.findOne({ tournamentId }).lean();
    expect(team.roster.map((r) => r.position)).toEqual(["P1", "P2", "P3", "P4", "P5"]);
    expect(team.roster[2]).toMatchObject({ position: "P3", name: "Cy", gender: "female" });
    expect(team.teamSize).toBe(5);
  });

  test("rejects a roster whose P3 is not female", async () => {
    const { tournamentId } = await seedTournament();
    const bad = players.map((p, i) => (i === 2 ? { ...p, gender: "male" } : p));
    const res = mockRes();
    await controller.registerRapidRalliesTeam({ body: { tournamentId: tournamentId.toString(), teamName: "Bad", players: bad } }, res);
    expect(res.statusCode).toBe(400);
  });

  test("register two teams via endpoint → generation builds the tie from their rosters", async () => {
    const { tournamentId } = await seedTournament();
    await controller.registerRapidRalliesTeam({ body: { tournamentId: tournamentId.toString(), teamName: "Home", players } }, mockRes());
    await controller.registerRapidRalliesTeam({ body: { tournamentId: tournamentId.toString(), teamName: "Away", players } }, mockRes());
    const gen = mockRes();
    await controller.generateRoundRobinMatches({ body: { tournamentId: tournamentId.toString(), scheduleDetails: schedule } }, gen);
    expect(gen.statusCode).toBe(201);
    const m = await TeamKnockoutMatches.findOne({ tournamentId }).lean();
    expect(m.sets).toHaveLength(5);
    expect(m.sets[0].homePlayer).toBe("Al"); // P1
    expect(m.sets[2].homePlayer).toBe("Cy"); // female P3
  });
});

describe("selectRapidRalliesPick — dynamic captain picks", () => {
  async function generated() {
    const { tournamentId } = await seedTournament();
    await TeamKnockoutTeams.collection.insertMany([makeTeam(tournamentId, "A"), makeTeam(tournamentId, "B")]);
    const res = mockRes();
    await controller.generateRoundRobinMatches({ body: { tournamentId: tournamentId.toString(), scheduleDetails: schedule } }, res);
    const m = await TeamKnockoutMatches.findOne({ tournamentId }).lean();
    return { tournamentId, matchId: m._id.toString() };
  }

  test("valid pick locks the partner onto the rubber", async () => {
    const { matchId } = await generated();
    const res = mockRes();
    await controller.selectRapidRalliesPick({ params: { matchId }, body: { side: "home", setNumber: 2, slot: "P4" } }, res);
    expect(res.statusCode).toBe(200);
    const m = await TeamKnockoutMatches.findById(matchId).lean();
    expect(m.rrSelections.home.partner2).toBe("P4");
    expect(m.sets[1].homePlayerB).toBe("A4"); // rubber 2 home partner
  });

  test("rejects out-of-pool pick", async () => {
    const { matchId } = await generated();
    const res = mockRes();
    await controller.selectRapidRalliesPick({ params: { matchId }, body: { side: "home", setNumber: 2, slot: "P1" } }, res);
    expect(res.statusCode).toBe(400);
  });

  test("rejects a pick that dooms participation (both partners on P3)", async () => {
    const { matchId } = await generated();
    // partner2 = P3 (ok)
    await controller.selectRapidRalliesPick({ params: { matchId }, body: { side: "home", setNumber: 2, slot: "P3" } }, mockRes());
    // partner4 = P3 → leaves only rubber-5 to cover BOTH P4 and P5 → invalid
    const res = mockRes();
    await controller.selectRapidRalliesPick({ params: { matchId }, body: { side: "home", setNumber: 4, slot: "P3" } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.allowed).toEqual(expect.arrayContaining(["P4", "P5"]));
  });

  test("getRapidRalliesOptions returns legal picks with names, narrowing as picks lock", async () => {
    const { matchId } = await generated();
    // Before any picks: partner2 options = P3/P4/P5 (with names)
    let res = mockRes();
    await controller.getRapidRalliesOptions({ params: { matchId } }, res);
    expect(res.statusCode).toBe(200);
    const before = res.body.data.home.partner2.options.map((o) => o.slot).sort();
    expect(before).toEqual(["P3", "P4", "P5"]);
    expect(res.body.data.home.partner2.options.find((o) => o.slot === "P4").name).toBe("A4");
    expect(res.body.data.femaleSlot).toBe("P3");

    // Lock partner2=P4, partner4=P3 → singles5 must be P5 (to cover P5)
    await controller.selectRapidRalliesPick({ params: { matchId }, body: { side: "home", setNumber: 2, slot: "P4" } }, mockRes());
    await controller.selectRapidRalliesPick({ params: { matchId }, body: { side: "home", setNumber: 4, slot: "P3" } }, mockRes());
    res = mockRes();
    await controller.getRapidRalliesOptions({ params: { matchId } }, res);
    expect(res.body.data.home.partner2.locked).toBe("P4");
    expect(res.body.data.home.singles5.options.map((o) => o.slot)).toEqual(["P5"]);
  });
});

describe("completeGame — playAllSets + league no-eliminate", () => {
  async function generated() {
    const { tournamentId } = await seedTournament();
    await TeamKnockoutTeams.collection.insertMany([makeTeam(tournamentId, "A"), makeTeam(tournamentId, "B")]);
    await controller.generateRoundRobinMatches({ body: { tournamentId: tournamentId.toString(), scheduleDetails: schedule } }, mockRes());
    const m = await TeamKnockoutMatches.findOne({ tournamentId }).lean();
    return { tournamentId, matchId: m._id.toString(), team1Id: m.team1Id, team2Id: m.team2Id };
  }

  const score = (matchId, setNumber, winner) =>
    controller.completeGame({
      params: { matchId },
      body: { setNumber, gameNumber: 1, finalHomePoints: winner === "home" ? 11 : 5, finalAwayPoints: winner === "home" ? 5 : 11 },
    }, mockRes());

  test("tie is NOT complete after 3 rubbers (all 5 must play)", async () => {
    const { matchId } = await generated();
    await score(matchId, 1, "home");
    await score(matchId, 2, "home");
    await score(matchId, 3, "home"); // home leads 3-0 but 2 rubbers unplayed
    const m = await TeamKnockoutMatches.findById(matchId).lean();
    expect(m.status).not.toBe("COMPLETED");
  });

  test("tie completes only when all 5 played; winner = more rubbers; loser NOT eliminated", async () => {
    const { matchId } = await generated();
    await score(matchId, 1, "home");
    await score(matchId, 2, "home");
    await score(matchId, 3, "home");
    await score(matchId, 4, "away");
    await score(matchId, 5, "away"); // 3-2 home
    const m = await TeamKnockoutMatches.findById(matchId).lean();
    expect(m.status).toBe("COMPLETED");
    expect(m.matchWinner).toBe("home");
    expect(String(m.winnerId)).toBe(String(m.team1Id));

    // League fixture (round 0) must not eliminate the loser
    const loser = await TeamKnockoutTeams.findById(m.team2Id).lean();
    expect(loser.status).toBe("ACTIVE");
    expect(loser.matchesLost).toBe(1);
  });

  test("standings: winner has 2 pts and ranks first", async () => {
    const { tournamentId, matchId } = await generated();
    for (const s of [1, 2, 3]) await score(matchId, s, "home");
    for (const s of [4, 5]) await score(matchId, s, "away");
    const res = mockRes();
    await controller.getRoundRobinStandings({ params: { tournamentId: tournamentId.toString() } }, res);
    expect(res.statusCode).toBe(200);
    const standings = res.body.data.standings;
    expect(standings[0].points).toBe(2);
    expect(standings[0].won).toBe(1);
    expect(standings[0].roundsWon).toBe(3); // 3 rubbers won
    expect(standings[1].points).toBe(0);
  });
});

describe("court-based umpire flow", () => {
  const { isUmpireAuthorizedForMatch } = require("../../utils/umpireAuth");
  const courtController = require("../../controllers/courtController");
  const User = require("../../src/modules/identity/models/User");
  const Referee = require("../../src/modules/catalog/models/Referee");

  async function seedWithCourts(courtDefs) {
    const tournamentId = OID();
    const sportId = OID();
    const fmt = { scoringType: "sets", totalSets: 5, setsToWin: 3, totalGames: 1, gamesToWin: 1, pointsToWinGame: 11, marginToWin: 2, deuceRule: true };
    await Tournament.collection.insertOne({
      _id: tournamentId,
      title: "Court Cup",
      davisCupFormatId: "rapid_rallies_s1",
      lineupMode: "dynamic",
      matchFormat: fmt,
      sports: [{ sportId, sportName: "Table Tennis", davisCupFormatId: "rapid_rallies_s1", matchFormat: fmt }],
      courts: courtDefs.map((c) => ({ _id: OID(), name: c.name, isActive: true, assignedUmpire: c.assignedUmpire || { refereeId: null, name: null } })),
    });
    return { tournamentId, sportId };
  }

  test("RR ties are distributed across the tournament's active courts", async () => {
    const { tournamentId } = await seedWithCourts([{ name: "Table 1" }, { name: "Table 2" }, { name: "Table 3" }]);
    await TeamKnockoutTeams.collection.insertMany([makeTeam(tournamentId, "A"), makeTeam(tournamentId, "B"), makeTeam(tournamentId, "C"), makeTeam(tournamentId, "D")]);
    const res = mockRes();
    await controller.generateRoundRobinMatches({ body: { tournamentId: tournamentId.toString(), scheduleDetails: schedule } }, res);
    expect(res.statusCode).toBe(201);
    const matches = await TeamKnockoutMatches.find({ tournamentId }).lean();
    expect(matches).toHaveLength(6); // 4 teams → 6 ties
    expect([...new Set(matches.map((m) => m.courtNumber))].sort()).toEqual(["Table 1", "Table 2", "Table 3"]);
  });

  test("court-based auth: assigned umpire is authorized on their court only", async () => {
    const umpireId = OID();
    const { tournamentId } = await seedWithCourts([
      { name: "Table 1", assignedUmpire: { refereeId: umpireId, name: "Ump A" } },
      { name: "Table 2" },
    ]);
    const onCourt = await isUmpireAuthorizedForMatch(umpireId, { _id: OID(), tournamentId, courtNumber: "Table 1" });
    expect(onCourt).toMatchObject({ authorized: true, via: "court-grant" });
    const otherCourt = await isUmpireAuthorizedForMatch(umpireId, { _id: OID(), tournamentId, courtNumber: "Table 2" });
    expect(otherCourt.authorized).toBe(false);
    const otherUser = await isUmpireAuthorizedForMatch(OID(), { _id: OID(), tournamentId, courtNumber: "Table 1" });
    expect(otherUser.authorized).toBe(false);
  });

  test("assignUmpireToCourt sets then unassigns the court umpire", async () => {
    const umpUser = OID();
    await User.collection.insertOne({ _id: umpUser, name: "Ump B" });
    await Referee.collection.insertOne({ _id: OID(), userId: umpUser });
    const { tournamentId } = await seedWithCourts([{ name: "Table 1" }]);
    const t = await Tournament.findById(tournamentId).lean();
    const courtId = t.courts[0]._id;
    const params = { tournamentId: tournamentId.toString(), courtId: courtId.toString() };

    let res = mockRes();
    await courtController.assignUmpireToCourt({ params, body: { refereeUserId: umpUser.toString() } }, res);
    expect(res.statusCode).toBe(200);
    let after = await Tournament.findById(tournamentId).lean();
    expect(String(after.courts[0].assignedUmpire.refereeId)).toBe(String(umpUser));
    expect(after.courts[0].assignedUmpire.name).toBe("Ump B");

    res = mockRes();
    await courtController.assignUmpireToCourt({ params, body: { refereeUserId: null } }, res);
    expect(res.statusCode).toBe(200);
    after = await Tournament.findById(tournamentId).lean();
    expect(after.courts[0].assignedUmpire.refereeId).toBeFalsy();
  });
});
