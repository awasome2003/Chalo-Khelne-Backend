"use strict";
/**
 * Doubles registration — a pair is ONE entrant, entered as a pair from the start.
 *
 * Two rules, both server-enforced:
 *
 *   1. A doubles category cannot be entered alone. A lone entrant reaches the
 *      draw as a single name with nobody to partner, which is unplayable.
 *   2. A person appears at most once per category — including when they were
 *      named as somebody else's partner. createBooking's existing
 *      "already registered" check only catches the same userId booking twice;
 *      it cannot see a person named as a partner on another player's booking.
 *
 * "Doubles" is resolved PER CATEGORY, so Men's Doubles requires a partner while
 * Men's Singles in the same tournament does not.
 */

const request = require("supertest");
const jwt = require("jsonwebtoken");
const {
  startTxApp,
  stopTxApp,
  clearDatabase,
} = require("./setupReplset");

const Tournament = require("../../src/modules/tournaments/models/Tournament");
const Sport = require("../../src/modules/catalog/models/Sport");
const Booking = require("../../src/modules/tournaments/models/BookingModel");
const User = require("../../src/modules/identity/models/User");
const Role = require("../../src/modules/identity/models/Role");
const Permission = require("../../src/modules/identity/models/Permission");

let app;

const FEE = 400;

async function seedPlayerRbac() {
  const permission = await Permission.create({
    key: "tournament:register",
    name: "Register for tournament",
    module: "tournament",
    action: "register",
  });
  await Role.create({
    name: "Player",
    slug: "player",
    authorityLevel: 4,
    permissions: [permission._id],
  });
}

beforeAll(async () => {
  app = await startTxApp();
});
afterAll(stopTxApp);
beforeEach(clearDatabase);

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
    email: `doubles-${uniq}-${Date.now()}@test.local`,
    password: "hashed-not-used",
    role: "Player",
    dateOfBirth: new Date("1995-01-01"),
    sex: "male",
    mobile: "9999999999",
  });
}

/**
 * A Table Tennis track carrying both a doubles and a singles category, with the
 * format declared per category — the shape the wizard now produces.
 */
async function seed() {
  await seedPlayerRbac();

  const sport = await Sport.create({
    name: "Table Tennis",
    category: "Racquet",
    scoringType: "sets",
  });

  const tournament = await Tournament.create({
    title: "Doubles Rules Cup",
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
        categories: [
          {
            name: "Men's Doubles",
            fee: FEE,
            groupStageFormat: "Singles",
            knockoutFormat: "Doubles", // doubles in the knockout only
            qualifyPerGroup: 3,
          },
          { name: "Men's Singles", fee: FEE },
        ],
      },
    ],
  });

  return { sport, tournament };
}

function payload({ player, tournament, sport, categoryName, partnerName }) {
  const selection = {
    sportId: String(sport._id),
    sportName: "Table Tennis",
    categoryName,
  };
  if (partnerName !== undefined) selection.partnerName = partnerName;

  return {
    userId: String(player._id),
    userName: player.name,
    tournamentId: String(tournament._id),
    tournamentName: tournament.title,
    tournamentType: "Group Stage",
    paymentMethod: "cash",
    sportSelections: [selection],
  };
}

const post = (player, body) =>
  request(app)
    .post("/api/tournaments/bookings/create")
    .set("Authorization", `Bearer ${playerToken(player._id)}`)
    .send(body);

describe("rule 1 — a doubles category requires a partner", () => {
  test("entering Men's Doubles with no partner is rejected", async () => {
    const { sport, tournament } = await seed();
    const player = await makePlayer("Rahul Kumar");

    const res = await post(
      player,
      payload({ player, tournament, sport, categoryName: "Men's Doubles" })
    );

    expect(res.status).toBe(400);
    expect(res.body.missingPartner).toEqual([
      { sportName: "Table Tennis", categoryName: "Men's Doubles" },
    ]);
    expect(await Booking.countDocuments()).toBe(0);
  });

  test("an empty or whitespace partner name counts as no partner", async () => {
    const { sport, tournament } = await seed();
    const player = await makePlayer("Rahul Kumar");

    const res = await post(
      player,
      payload({
        player,
        tournament,
        sport,
        categoryName: "Men's Doubles",
        partnerName: "   ",
      })
    );

    expect(res.status).toBe(400);
    expect(await Booking.countDocuments()).toBe(0);
  });

  test("entering with a partner succeeds and stores the partner on that category", async () => {
    const { sport, tournament } = await seed();
    const player = await makePlayer("Rahul Kumar");

    const res = await post(
      player,
      payload({
        player,
        tournament,
        sport,
        categoryName: "Men's Doubles",
        partnerName: "Amit Shah",
      })
    );

    expect(res.status).toBeLessThan(400);

    const booking = await Booking.findOne({ userId: player._id }).lean();
    expect(booking.sportSelections[0].partnerName).toBe("Amit Shah");
  });

  test("a singles category needs no partner", async () => {
    const { sport, tournament } = await seed();
    const player = await makePlayer("Rahul Kumar");

    const res = await post(
      player,
      payload({ player, tournament, sport, categoryName: "Men's Singles" })
    );

    expect(res.status).toBeLessThan(400);
  });

  test("a partner sent for a singles category is discarded", async () => {
    const { sport, tournament } = await seed();
    const player = await makePlayer("Rahul Kumar");

    await post(
      player,
      payload({
        player,
        tournament,
        sport,
        categoryName: "Men's Singles",
        partnerName: "Amit Shah",
      })
    );

    const booking = await Booking.findOne({ userId: player._id }).lean();
    expect(booking.sportSelections[0].partnerName).toBeNull();
  });
});

describe("rule 2 — one person per category, partners included", () => {
  test("a player already named as a partner cannot be entered again by someone else", async () => {
    const { sport, tournament } = await seed();
    const rahul = await makePlayer("Rahul Kumar");
    const vijay = await makePlayer("Vijay Rao");

    // Rahul enters with Amit as his partner.
    const first = await post(
      rahul,
      payload({
        player: rahul,
        tournament,
        sport,
        categoryName: "Men's Doubles",
        partnerName: "Amit Shah",
      })
    );
    expect(first.status).toBeLessThan(400);

    // Vijay now tries to claim Amit too.
    const second = await post(
      vijay,
      payload({
        player: vijay,
        tournament,
        sport,
        categoryName: "Men's Doubles",
        partnerName: "Amit Shah",
      })
    );

    expect(second.status).toBe(409);
    expect(second.body.conflicts).toEqual([
      { sportName: "Table Tennis", categoryName: "Men's Doubles", name: "amit shah" },
    ]);
    expect(await Booking.countDocuments()).toBe(1);
  });

  test("the conflict is caught whichever order the pair was typed", async () => {
    const { sport, tournament } = await seed();
    const rahul = await makePlayer("Rahul Kumar");
    const vijay = await makePlayer("Vijay Rao");

    await post(
      rahul,
      payload({
        player: rahul,
        tournament,
        sport,
        categoryName: "Men's Doubles",
        partnerName: "Amit Shah",
      })
    );

    // Vijay names Rahul — who is the OWNER of the existing entry, not a partner.
    const res = await post(
      vijay,
      payload({
        player: vijay,
        tournament,
        sport,
        categoryName: "Men's Doubles",
        partnerName: "Rahul Kumar",
      })
    );

    expect(res.status).toBe(409);
    expect(res.body.conflicts[0].name).toBe("rahul kumar");
  });

  test("matching ignores casing and extra whitespace", async () => {
    const { sport, tournament } = await seed();
    const rahul = await makePlayer("Rahul Kumar");
    const vijay = await makePlayer("Vijay Rao");

    await post(
      rahul,
      payload({
        player: rahul,
        tournament,
        sport,
        categoryName: "Men's Doubles",
        partnerName: "Amit Shah",
      })
    );

    const res = await post(
      vijay,
      payload({
        player: vijay,
        tournament,
        sport,
        categoryName: "Men's Doubles",
        partnerName: "  amit   SHAH ",
      })
    );

    expect(res.status).toBe(409);
  });

  test("a different partner is accepted — the rule blocks the person, not the category", async () => {
    const { sport, tournament } = await seed();
    const rahul = await makePlayer("Rahul Kumar");
    const vijay = await makePlayer("Vijay Rao");

    await post(
      rahul,
      payload({
        player: rahul,
        tournament,
        sport,
        categoryName: "Men's Doubles",
        partnerName: "Amit Shah",
      })
    );

    const res = await post(
      vijay,
      payload({
        player: vijay,
        tournament,
        sport,
        categoryName: "Men's Doubles",
        partnerName: "Sunil Patel",
      })
    );

    expect(res.status).toBeLessThan(400);
    expect(await Booking.countDocuments()).toBe(2);
  });

  test("the same person may enter a DIFFERENT category", async () => {
    const { sport, tournament } = await seed();
    const rahul = await makePlayer("Rahul Kumar");
    const vijay = await makePlayer("Vijay Rao");

    // Amit is Rahul's doubles partner...
    await post(
      rahul,
      payload({
        player: rahul,
        tournament,
        sport,
        categoryName: "Men's Doubles",
        partnerName: "Amit Shah",
      })
    );

    // ...which must not block Vijay entering the singles category.
    const res = await post(
      vijay,
      payload({ player: vijay, tournament, sport, categoryName: "Men's Singles" })
    );

    expect(res.status).toBeLessThan(400);
  });
});
