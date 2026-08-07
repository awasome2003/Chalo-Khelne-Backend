"use strict";
/**
 * §2.7 regression — coupons must actually apply, and both caps must be
 * enforced server-side.
 *
 * Three compounding defects this pins shut:
 *   (a) the discount never reached the booking — BookingModel declared no
 *       coupon field and BookingController never read one, so applying a coupon
 *       changed a number on the client and nothing on the server;
 *   (b) the per-user limit was checked against a user id the CLIENT supplied,
 *       inside `if (user_id) { … }` — omitting the field skipped it entirely;
 *   (c) the global limit was enforced by asking the client to report its own
 *       usage via a separate /record-usage call that nothing linked to the
 *       booking, so a client that never called it kept the coupon good forever.
 */

const request = require("supertest");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { startTxApp, stopTxApp, clearDatabase } = require("./setupReplset");

const Tournament = require("../../src/modules/tournaments/models/Tournament");
const Sport = require("../../src/modules/catalog/models/Sport");
const Booking = require("../../src/modules/tournaments/models/BookingModel");
const User = require("../../src/modules/identity/models/User");
const Role = require("../../src/modules/identity/models/Role");
const Permission = require("../../src/modules/identity/models/Permission");
const Coupon = require("../../src/modules/commerce/models/Coupon");
const CouponUsage = require("../../src/modules/commerce/models/CouponUsage");

const { redeemCoupon, CouponError } = require("../../services/couponService");

let app;
const REAL_FEE = 1000;

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

async function seedRbac() {
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

async function makePlayer(suffix = "") {
  return User.create({
    name: `Coupon Player ${suffix}`,
    email: `coupon-${suffix}-${Date.now()}@test.local`,
    password: "hashed-not-used",
    role: "Player",
    dateOfBirth: new Date("1995-01-01"),
    sex: "male",
    mobile: "9999999999",
  });
}

async function seed({ couponOverrides = {} } = {}) {
  await seedRbac();

  const sport = await Sport.create({
    name: "Carrom",
    category: "Board",
    scoringType: "board",
  });

  const tournament = await Tournament.create({
    title: "Coupon Cup",
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

  const coupon = await Coupon.create({
    code: "SAVE20",
    discountType: "percentage",
    discountValue: 20,
    applicableTo: "all",
    expiryDate: new Date("2031-01-01"),
    minAmount: 0,
    perUserLimit: 1,
    createdBy: new mongoose.Types.ObjectId(),
    ...couponOverrides,
  });

  const player = await makePlayer("a");
  return { sport, tournament, coupon, player };
}

function payload({ player, tournament, sport, couponCode }) {
  const body = {
    userId: String(player._id),
    userName: player.name,
    tournamentId: String(tournament._id),
    tournamentName: tournament.title,
    tournamentType: "Group Stage",
    paymentMethod: "cash",
    sportSelections: [
      {
        sportId: String(sport._id),
        sportName: "Carrom",
        categoryName: "Open",
      },
    ],
  };
  if (couponCode) body.couponCode = couponCode;
  return body;
}

function book(player, body) {
  return request(app)
    .post("/api/tournaments/bookings/create")
    .set("Authorization", `Bearer ${playerToken(player._id)}`)
    .send(body);
}

describe("coupon discount reaches the booking (§2.7a)", () => {
  test("a valid coupon reduces paymentAmount and is recorded on the booking", async () => {
    const { sport, tournament, player } = await seed();

    const res = await book(player, payload({ player, tournament, sport, couponCode: "SAVE20" }));
    expect(res.status).toBeLessThan(400);

    const booking = await Booking.findOne({ userId: player._id }).lean();
    // totalFee stays the pre-discount price…
    expect(booking.totalFee).toBe(REAL_FEE);
    // …paymentAmount is what the player actually owes.
    expect(booking.paymentAmount).toBe(800);
    expect(booking.coupon.code).toBe("SAVE20");
    expect(booking.coupon.discountAmount).toBe(200);
    expect(booking.coupon.couponId).toBeTruthy();
    expect(booking.coupon.usageId).toBeTruthy();
  });

  test("booking without a coupon owes the full fee", async () => {
    const { sport, tournament, player } = await seed();

    const res = await book(player, payload({ player, tournament, sport }));
    expect(res.status).toBeLessThan(400);

    const booking = await Booking.findOne({ userId: player._id }).lean();
    expect(booking.paymentAmount).toBe(REAL_FEE);
    expect(booking.coupon.couponId).toBeNull();
    expect(booking.coupon.discountAmount).toBe(0);
  });

  test("redemption writes exactly one ledger row with server-computed amounts", async () => {
    const { sport, tournament, player } = await seed();

    await book(player, payload({ player, tournament, sport, couponCode: "SAVE20" }));

    const usages = await CouponUsage.find({}).lean();
    expect(usages).toHaveLength(1);
    expect(usages[0].originalAmount).toBe(REAL_FEE);
    expect(usages[0].discountAmount).toBe(200);
    expect(usages[0].finalAmount).toBe(800);
    expect(String(usages[0].userId)).toBe(String(player._id));
  });

  test("usedCount is incremented by redemption, not by a client call", async () => {
    const { sport, tournament, player, coupon } = await seed();

    await book(player, payload({ player, tournament, sport, couponCode: "SAVE20" }));

    const after = await Coupon.findById(coupon._id).lean();
    expect(after.usedCount).toBe(1);
  });
});

describe("caps are enforced server-side (§2.7b, §2.7c)", () => {
  test("per-user limit is enforced from the token, with no user_id in the body", async () => {
    const { sport, tournament, player } = await seed();

    // First redemption succeeds.
    const first = await book(player, payload({ player, tournament, sport, couponCode: "SAVE20" }));
    expect(first.status).toBeLessThan(400);

    // Same player, a different tournament, so the (userId, tournamentId)
    // unique index does not mask the coupon check.
    const sport2 = await Sport.create({ name: "Chess", category: "Board", scoringType: "single" });
    const tournament2 = await Tournament.create({
      title: "Coupon Cup 2",
      startDate: new Date("2030-02-01"),
      endDate: new Date("2030-02-05"),
      sports: [
        {
          sportId: sport2._id,
          sportName: "Chess",
          tournamentLevel: "unranked",
          categories: [{ name: "Open", fee: REAL_FEE }],
        },
      ],
    });

    const second = await book(
      player,
      payload({ player, tournament: tournament2, sport: sport2, couponCode: "SAVE20" })
    );

    expect(second.status).toBe(400);
    expect(second.body.message).toMatch(/already used/i);
    // The whole booking aborted — no half-applied state.
    expect(await Booking.countDocuments({ tournamentId: tournament2._id })).toBe(0);
    expect(await CouponUsage.countDocuments({})).toBe(1);
  });

  test("global usage limit cannot be exceeded", async () => {
    const { sport, tournament } = await seed({
      couponOverrides: { usageLimit: 1, perUserLimit: 5 },
    });

    const p1 = await makePlayer("one");
    const p2 = await makePlayer("two");

    const r1 = await book(p1, payload({ player: p1, tournament, sport, couponCode: "SAVE20" }));
    expect(r1.status).toBeLessThan(400);

    const r2 = await book(p2, payload({ player: p2, tournament, sport, couponCode: "SAVE20" }));
    expect(r2.status).toBe(400);
    expect(r2.body.message).toMatch(/usage limit/i);

    const coupon = await Coupon.findOne({ code: "SAVE20" }).lean();
    expect(coupon.usedCount).toBe(1); // not 2
  });

  test("an expired coupon is refused and the booking is not created", async () => {
    const { sport, tournament, player } = await seed({
      couponOverrides: { expiryDate: new Date("2020-01-01") },
    });

    const res = await book(player, payload({ player, tournament, sport, couponCode: "SAVE20" }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expired/i);
    expect(await Booking.countDocuments({ userId: player._id })).toBe(0);
  });

  test("an unknown coupon code is refused", async () => {
    const { sport, tournament, player } = await seed();

    const res = await book(
      player,
      payload({ player, tournament, sport, couponCode: "NOSUCHCODE" })
    );
    expect(res.status).toBe(400);
    expect(await Booking.countDocuments({ userId: player._id })).toBe(0);
  });
});

describe("the standalone redemption endpoint is gone (§2.7c)", () => {
  test("POST /api/coupons/record-usage no longer exists", async () => {
    const player = await makePlayer("route");
    const res = await request(app)
      .post("/api/coupons/record-usage")
      .set("Authorization", `Bearer ${playerToken(player._id)}`)
      .send({ coupon_id: new mongoose.Types.ObjectId(), user_id: String(player._id) });

    expect(res.status).toBe(404);
  });
});

describe("concurrent redemption cannot oversell (§2.7c)", () => {
  test("the last remaining use is claimed exactly once", async () => {
    await seedRbac();
    const coupon = await Coupon.create({
      code: "LASTONE",
      discountType: "flat",
      discountValue: 100,
      applicableTo: "all",
      expiryDate: new Date("2031-01-01"),
      minAmount: 0,
      usageLimit: 1,
      perUserLimit: 5,
      createdBy: new mongoose.Types.ObjectId(),
    });

    const players = await Promise.all([makePlayer("c1"), makePlayer("c2"), makePlayer("c3")]);
    const appliedId = new mongoose.Types.ObjectId();

    // Fire concurrent redemptions. `coupon.usedCount += 1; save()` — the old
    // read-modify-write — loses increments here and lets the cap be exceeded.
    const results = await Promise.allSettled(
      players.map((p) =>
        redeemCoupon({
          code: "LASTONE",
          userId: p._id,
          appliedTo: "tournament",
          appliedId,
          totalAmount: 500,
        })
      )
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);

    const after = await Coupon.findById(coupon._id).lean();
    expect(after.usedCount).toBe(1);
    expect(await CouponUsage.countDocuments({})).toBe(1);
  });
});
