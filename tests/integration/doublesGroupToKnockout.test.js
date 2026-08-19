"use strict";
/**
 * Doubles, end to end: registration → group → fixtures → knockout cutoff.
 *
 * Each stage previously broke the next, and each fix only makes sense as part of
 * the chain, so this drives the real endpoints in order:
 *
 *   1. A pair registers as ONE booking, partner stored per (booking, category).
 *   2. The group row is named "A & B" — read from the selection matching THIS
 *      group's category, not from the booking's single userName.
 *   3. Fixtures are a round-robin between pair-entrants. The generator must NOT
 *      re-pair them: entrants are already pairs, so joining them two-at-a-time
 *      would put four people on one side of a match.
 *   4. The knockout cutoff is per CATEGORY — "top 3" for Men's Doubles even
 *      though the sport track says 2.
 */

const request = require("supertest");
const jwt = require("jsonwebtoken");
const {
  startTxApp,
  stopTxApp,
  clearDatabase,
  superAdminToken,
} = require("./setupReplset");

const Tournament = require("../../src/modules/tournaments/models/Tournament");
const Sport = require("../../src/modules/catalog/models/Sport");
const Booking = require("../../src/modules/tournaments/models/BookingModel");
const BookingGroup = require("../../src/modules/tournaments/models/bookinggroup");
const Match = require("../../src/modules/tournaments/models/Tournnamentmatch");
const GroupStandings = require("../../src/modules/tournaments/models/GroupStandings");
const User = require("../../src/modules/identity/models/User");
const Role = require("../../src/modules/identity/models/Role");
const Permission = require("../../src/modules/identity/models/Permission");

let app;
let saToken;

const CATEGORY = "Men's Doubles";
const QUALIFY_PER_CATEGORY = 3; // track says 2 — the category overrides it

beforeAll(async () => {
  app = await startTxApp();
});
afterAll(stopTxApp);

beforeEach(async () => {
  await clearDatabase();
  await seedRbac();
  saToken = superAdminToken();
});

// The manage routes are permission-gated; the register route needs its own.
async function seedRbac() {
  const perms = await Permission.insertMany([
    { key: "tournament:register", name: "Register", module: "tournament", action: "register" },
    { key: "tournament:manage", name: "Manage", module: "tournament", action: "manage" },
  ]);
  await Role.create({
    name: "Player",
    slug: "player",
    authorityLevel: 4,
    permissions: perms.map((p) => p._id),
  });
}

function playerToken(userId) {
  return jwt.sign({ id: String(userId), role: "Player" }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
}

let uniq = 0;
async function makePlayer(name) {
  uniq += 1;
  return User.create({
    name,
    email: `d2k-${uniq}-${Date.now()}@test.local`,
    password: "hashed-not-used",
    role: "Player",
    dateOfBirth: new Date("1995-01-01"),
    sex: "male",
    mobile: "9999999999",
  });
}

async function seedTournament() {
  const sport = await Sport.create({
    name: "Table Tennis",
    category: "Racquet",
    scoringType: "sets",
  });

  const tournament = await Tournament.create({
    title: "Doubles Chain Cup",
    startDate: new Date("2030-01-01"),
    endDate: new Date("2030-01-05"),
    sports: [
      {
        sportId: sport._id,
        sportName: "Table Tennis",
        tournamentLevel: "unranked",
        type: "knockout + group stage",
        formatScope: "category",
        groupStageFormat: "Singles",
        knockoutFormat: "Singles",
        qualifyPerGroup: 2, // deliberately different from the category
        categories: [
          {
            name: CATEGORY,
            fee: 0,
            groupStageFormat: "Doubles",
            knockoutFormat: "Doubles",
            qualifyPerGroup: QUALIFY_PER_CATEGORY,
          },
        ],
        matchFormat: { totalSets: 3, setsToWin: 2, scoringType: "sets" },
      },
    ],
  });

  return { sport, tournament };
}

/** Register one pair as a single booking, and confirm it so grouping accepts it. */
async function registerPair(tournament, sport, leadName, partnerName) {
  const lead = await makePlayer(leadName);
  const res = await request(app)
    .post("/api/tournaments/bookings/create")
    .set("Authorization", `Bearer ${playerToken(lead._id)}`)
    .send({
      userId: String(lead._id),
      userName: lead.name,
      tournamentId: String(tournament._id),
      tournamentName: tournament.title,
      tournamentType: "Group Stage",
      paymentMethod: "cash",
      sportSelections: [{
        sportId: String(sport._id),
        sportName: "Table Tennis",
        categoryName: CATEGORY,
        partnerName,
      }],
    });
  expect(res.status).toBeLessThan(400);

  const booking = await Booking.findOne({ userId: lead._id });
  booking.status = "confirmed";
  await booking.save({ validateModifiedOnly: true });
  return booking;
}

describe("doubles: registration → group → fixtures → knockout", () => {
  test("the whole chain carries the pair through", async () => {
    const { sport, tournament } = await seedTournament();

    // ── 1. Four pairs register ──
    const bookings = [];
    for (const [lead, partner] of [
      ["Rahul Kumar", "Amit Shah"],
      ["Vijay Rao", "Sunil Patel"],
      ["Karan Mehta", "Rohit Nair"],
      ["Dev Joshi", "Nikhil Rane"],
    ]) {
      bookings.push(await registerPair(tournament, sport, lead, partner));
    }

    // One booking per PAIR — not per person.
    expect(await Booking.countDocuments()).toBe(4);
    expect(bookings[0].sportSelections[0].partnerName).toBe("Amit Shah");

    // ── 2. The group names each row "A & B" ──
    const groupRes = await request(app)
      .post("/api/tournaments/bookinggroups/create")
      .set("Authorization", `Bearer ${saToken}`)
      .send({
        tournamentId: String(tournament._id),
        sportId: String(sport._id),
        groupName: "Group A",
        category: CATEGORY,
        players: bookings.map((b) => String(b._id)),
        round: 1,
        roundType: "group_stage",
      });
    expect(groupRes.status).toBeLessThan(400);

    const group = await BookingGroup.findOne({ tournamentId: tournament._id }).lean();
    expect(group.players).toHaveLength(4); // 4 pair-entrants, not 8 people
    expect(group.players.map((p) => p.userName)).toEqual([
      "Rahul Kumar & Amit Shah",
      "Vijay Rao & Sunil Patel",
      "Karan Mehta & Rohit Nair",
      "Dev Joshi & Nikhil Rane",
    ]);

    // ── 3. Fixtures: a round-robin between pairs, NOT re-paired ──
    const matchRes = await request(app)
      .post("/api/tournaments/matches/generate-group")
      .set("Authorization", `Bearer ${saToken}`)
      .send({
        tournamentId: String(tournament._id),
        groupId: String(group._id),
        sportId: String(sport._id),
        courtNumber: "1",
        startTime: new Date("2030-01-01T09:00:00Z").toISOString(),
        slotDurationMinutes: 30,
        matchDurationMinutes: 30,
      });
    expect(matchRes.status).toBeLessThan(400);

    const matches = await Match.find({ groupId: group._id }).lean();
    // 4 entrants meeting once each = 6. The legacy re-pairing path would have
    // produced 1 match between two merged super-pairs.
    expect(matches).toHaveLength(6);
    expect(matches.every((m) => m.matchType === "doubles")).toBe(true);

    // Every side is a whole pair, and nobody plays themselves.
    for (const m of matches) {
      expect(m.player1.userName).toContain(" & ");
      expect(m.player2.userName).toContain(" & ");
      expect(m.player1.userName).not.toBe(m.player2.userName);
    }

    // All four pairs appear across the fixture list.
    const seen = new Set(matches.flatMap((m) => [m.player1.userName, m.player2.userName]));
    expect(seen.size).toBe(4);

    // ── 4. The knockout cutoff is the CATEGORY's, not the track's ──
    // Standings are seeded directly: the cutoff is what is under test here, not
    // the scoring engine.
    await Match.updateMany({ groupId: group._id }, { $set: { status: "COMPLETED" } });
    await GroupStandings.create({
      tournamentId: tournament._id,
      groupId: group._id,
      groupName: group.groupName,
      sportId: sport._id,
      standings: group.players.map((p, i) => ({
        playerId: p.playerId,
        playerName: p.userName,
        rank: i + 1,
        played: 3,
        won: 3 - i,
        lost: i,
        totalPoints: (3 - i) * 3,
      })),
    });

    const transitionRes = await request(app)
      .post("/api/tournaments/matches/transition-to-knockout")
      .set("Authorization", `Bearer ${saToken}`)
      .send({ tournamentId: String(tournament._id), sportId: String(sport._id) });

    expect(transitionRes.status).toBe(200);

    // 3 advance — the category value — not the track's 2.
    expect(transitionRes.body.qualifiedPlayers).toHaveLength(QUALIFY_PER_CATEGORY);
    expect(transitionRes.body.qualifyPerGroupByCategory[CATEGORY]).toBe(QUALIFY_PER_CATEGORY);

    // Qualifiers carry the PAIR name into the bracket — the knockout renders an
    // entrant as one name and has no second playerId to fall back on.
    for (const q of transitionRes.body.qualifiedPlayers) {
      expect(q.userName).toContain(" & ");
    }
    expect(transitionRes.body.qualifiedPlayers[0].userName).toBe("Rahul Kumar & Amit Shah");
  });

  test("a singles category in the same tournament is unaffected", async () => {
    const { sport, tournament } = await seedTournament();
    // Add a singles category alongside the doubles one.
    await Tournament.updateOne(
      { _id: tournament._id },
      { $push: { "sports.0.categories": { name: "Men's Singles", fee: 0 } } }
    );

    const player = await makePlayer("Solo Player");
    const res = await request(app)
      .post("/api/tournaments/bookings/create")
      .set("Authorization", `Bearer ${playerToken(player._id)}`)
      .send({
        userId: String(player._id),
        userName: player.name,
        tournamentId: String(tournament._id),
        tournamentName: tournament.title,
        tournamentType: "Group Stage",
        paymentMethod: "cash",
        sportSelections: [{
          sportId: String(sport._id),
          sportName: "Table Tennis",
          categoryName: "Men's Singles",
        }],
      });

    // No partner needed, and none stored.
    expect(res.status).toBeLessThan(400);
    const booking = await Booking.findOne({ userId: player._id }).lean();
    expect(booking.sportSelections[0].partnerName).toBeNull();

    const groupRes = await request(app)
      .post("/api/tournaments/bookinggroups/create")
      .set("Authorization", `Bearer ${saToken}`)
      .send({
        tournamentId: String(tournament._id),
        sportId: String(sport._id),
        groupName: "Singles A",
        category: "Men's Singles",
        players: [String(booking._id)],
        round: 1,
        roundType: "group_stage",
      });
    expect(groupRes.status).toBeLessThan(400);

    const group = await BookingGroup.findOne({ category: "Men's Singles" }).lean();
    // Plain name — pairDisplayName leaves a partnerless entrant alone.
    expect(group.players[0].userName).toBe("Solo Player");
  });
});
