"use strict";
/**
 * §2.4 regression — registration fees must be derived from the tournament,
 * never from the request body.
 *
 * createBooking used to map the client's payload straight through
 * (`fee: Number(s.fee)`) and sum those values into totalFee under a comment
 * asserting the opposite. A player could post fee: 1 for a ₹2,500 category and
 * the booking, the manager's payment notification and the club-admin finance
 * aggregate would all read ₹1 — permanently, because nothing downstream ever
 * re-derived the real price.
 *
 * §6.3.2 is covered here too: an unknown category name used to `continue` past
 * the age/gender gate entirely and then be priced by the client.
 */

const request = require("supertest");
const mongoose = require("mongoose");
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
const User = require("../../src/modules/identity/models/User");
const Role = require("../../src/modules/identity/models/Role");
const Permission = require("../../src/modules/identity/models/Permission");

let app;

const REAL_FEE = 2500;

// The route is gated by requirePermission("tournament:register"), which
// resolves the caller's RBAC Role from the database. Seed the player role and
// its grant so the test exercises the fee logic rather than the 403.
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
  return jwt.sign(
    { id: String(userId), role: "Player" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

async function seed() {
  await seedPlayerRbac();

  const sport = await Sport.create({
    name: "Carrom",
    category: "Board",
    scoringType: "board",
  });

  const player = await User.create({
    name: "Fee Test Player",
    email: `fee-${Date.now()}@test.local`,
    password: "hashed-not-used",
    role: "Player",
    dateOfBirth: new Date("1995-01-01"),
    sex: "male",
    mobile: "9999999999",
  });

  const tournament = await Tournament.create({
    title: "Fee Integrity Cup",
    startDate: new Date("2030-01-01"),
    endDate: new Date("2030-01-05"),
    sports: [
      {
        sportId: sport._id,
        sportName: "Carrom",
        tournamentLevel: "unranked",
        categories: [{ name: "Open", fee: REAL_FEE }],
      },
    ],
  });

  return { sport, player, tournament };
}

function payload({ player, tournament, sport, fee }) {
  return {
    userId: String(player._id),
    userName: player.name,
    tournamentId: String(tournament._id),
    tournamentName: tournament.title,
    tournamentType: "Group Stage",
    paymentMethod: "cash",
    paymentAmount: fee,
    totalFee: fee,
    sportSelections: [
      {
        sportId: String(sport._id),
        sportName: "Carrom",
        categoryName: "Open",
        fee, // ← the value under test; the server must ignore it
      },
    ],
  };
}

describe("registration fee integrity (§2.4)", () => {
  test("a client-supplied fee of 1 does NOT become the booking price", async () => {
    const { sport, player, tournament } = await seed();

    const res = await request(app)
      .post("/api/tournaments/bookings/create")
      .set("Authorization", `Bearer ${playerToken(player._id)}`)
      .send(payload({ player, tournament, sport, fee: 1 }));

    expect(res.status).toBeLessThan(400);

    const booking = await Booking.findOne({ userId: player._id }).lean();
    expect(booking).toBeTruthy();
    expect(booking.totalFee).toBe(REAL_FEE);
    expect(booking.paymentAmount).toBe(REAL_FEE);
    expect(booking.sportSelections[0].fee).toBe(REAL_FEE);
  });

  test("a client-supplied fee of 0 does not make a paid tournament free", async () => {
    const { sport, player, tournament } = await seed();

    const res = await request(app)
      .post("/api/tournaments/bookings/create")
      .set("Authorization", `Bearer ${playerToken(player._id)}`)
      .send(payload({ player, tournament, sport, fee: 0 }));

    expect(res.status).toBeLessThan(400);

    const booking = await Booking.findOne({ userId: player._id }).lean();
    expect(booking.totalFee).toBe(REAL_FEE);
  });

  test("an inflated client fee is also ignored", async () => {
    const { sport, player, tournament } = await seed();

    const res = await request(app)
      .post("/api/tournaments/bookings/create")
      .set("Authorization", `Bearer ${playerToken(player._id)}`)
      .send(payload({ player, tournament, sport, fee: 999999 }));

    expect(res.status).toBeLessThan(400);

    const booking = await Booking.findOne({ userId: player._id }).lean();
    expect(booking.totalFee).toBe(REAL_FEE);
  });

  test("omitting fee entirely still prices the booking correctly", async () => {
    const { sport, player, tournament } = await seed();

    const body = payload({ player, tournament, sport, fee: 1 });
    delete body.sportSelections[0].fee;
    delete body.totalFee;
    delete body.paymentAmount;

    const res = await request(app)
      .post("/api/tournaments/bookings/create")
      .set("Authorization", `Bearer ${playerToken(player._id)}`)
      .send(body);

    expect(res.status).toBeLessThan(400);

    const booking = await Booking.findOne({ userId: player._id }).lean();
    expect(booking.totalFee).toBe(REAL_FEE);
  });
});

describe("unknown categories are rejected (§6.3.2)", () => {
  test("a category the tournament does not contain is a 400, not a free pass", async () => {
    const { sport, player, tournament } = await seed();

    const body = payload({ player, tournament, sport, fee: 1 });
    body.sportSelections[0].categoryName = "Category That Does Not Exist";

    const res = await request(app)
      .post("/api/tournaments/bookings/create")
      .set("Authorization", `Bearer ${playerToken(player._id)}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(await Booking.countDocuments({ userId: player._id })).toBe(0);
  });
});

describe("UPI transaction reference is persisted (§2.6)", () => {
  test("transactionId submitted with an online booking is stored, not dropped", async () => {
    const { sport, player, tournament } = await seed();

    const body = payload({ player, tournament, sport, fee: 1 });
    body.paymentMethod = "online";
    body.transactionId = "UPI-REF-1234567890";

    const res = await request(app)
      .post("/api/tournaments/bookings/create")
      .set("Authorization", `Bearer ${playerToken(player._id)}`)
      .send(body);

    expect(res.status).toBeLessThan(400);

    const booking = await Booking.findOne({ userId: player._id }).lean();
    // Before the schema declared this path, Mongoose silently discarded the
    // assignment and the manager had nothing to reconcile a bank statement
    // against.
    expect(booking.transactionId).toBe("UPI-REF-1234567890");
    // …and the fee is still server-derived on this path too.
    expect(booking.totalFee).toBe(REAL_FEE);
  });

  test("the schema rejects undeclared fields instead of dropping them", async () => {
    const { sport, player, tournament } = await seed();

    // strict: "throw" — the guard that makes a repeat of §2.6 impossible.
    // Mongoose raises a StrictModeError at $set time, i.e. on construction,
    // rather than deferring to save(). Either way the write cannot land
    // silently, which is the property under test.
    expect(() => {
      // eslint-disable-next-line no-new
      new Booking({
        userId: player._id,
        userName: player.name,
        tournamentId: tournament._id,
        tournamentName: tournament.title,
        tournamentType: "Group Stage",
        sportSelections: [
          { sportId: sport._id, sportName: "Carrom", categoryName: "Open", fee: REAL_FEE },
        ],
        totalFee: REAL_FEE,
        someFieldNobodyDeclared: "should not be silently swallowed",
      });
    }).toThrow(/strict mode|someFieldNobodyDeclared/i);
  });
});
