"use strict";
/**
 * §2.5 regression — the payment-proof workflow must be reachable.
 *
 * Everything existed except the step that starts it: a PlayerPayment model, an
 * uploadPaymentProof controller, a manager review endpoint, a transactional
 * verify with an idempotency guard, and a full web screen routed at
 * /payment-proof-review and linked from the manager sidebar as "Payment
 * Reviews". No route reached uploadPaymentProof — the symbol appeared only in
 * its own definition — so no PlayerPayment document could ever be created.
 *
 * The manager's inbox was therefore permanently empty, and silently so: the
 * query ran fine and returned zero rows, which is indistinguishable from "no
 * one has paid yet".
 *
 * §7.4 is covered here too: the proof now carries the amount it is evidence
 * for, and one UPI reference backs at most one live proof.
 */

const request = require("supertest");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { startTxApp, stopTxApp, clearDatabase } = require("./setupReplset");

const Tournament = require("../../src/modules/tournaments/models/Tournament");
const Sport = require("../../src/modules/catalog/models/Sport");
const Booking = require("../../src/modules/tournaments/models/BookingModel");
const User = require("../../src/modules/identity/models/User");
const PlayerPayment = require("../../src/modules/commerce/models/playerPaymentSchema");
const { Manager } = require("../../src/modules/identity/models/ClubManager");

let app;
const FEE = 2500;

beforeAll(async () => {
  app = await startTxApp();
  // The partial-unique index on transactionId is what makes the duplicate
  // test meaningful; autoIndex is off in the harness, so build it explicitly.
  await PlayerPayment.syncIndexes();
});
afterAll(stopTxApp);
beforeEach(async () => {
  await clearDatabase();
  await PlayerPayment.syncIndexes();
});

function playerToken(userId) {
  return jwt.sign({ id: String(userId), role: "Player" }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
}
function mgrToken(managerId) {
  return jwt.sign({ id: String(managerId), role: "Manager" }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
}

async function seed() {
  const clubAdminId = new mongoose.Types.ObjectId();
  const manager = await Manager.create({
    name: "Proof Manager",
    email: `mgr-${Date.now()}@test.local`,
    password: "hashed-not-used",
    mobile: "9888888888",
    clubId: clubAdminId,
  });

  const player = await User.create({
    name: "Proof Player",
    email: `proof-${Date.now()}@test.local`,
    password: "hashed-not-used",
    role: "Player",
    dateOfBirth: new Date("1995-01-01"),
    sex: "male",
    mobile: "9999999999",
  });

  const sport = await Sport.create({
    name: "Carrom",
    category: "Board",
    scoringType: "board",
  });

  const tournament = await Tournament.create({
    title: "Proof Cup",
    startDate: new Date("2030-01-01"),
    endDate: new Date("2030-01-05"),
    managerId: [manager._id],
    sports: [
      {
        sportId: sport._id,
        sportName: "Carrom",
        tournamentLevel: "unranked",
        categories: [{ name: "Open", fee: FEE }],
      },
    ],
  });

  const booking = await Booking.create({
    userId: player._id,
    userName: player.name,
    tournamentId: tournament._id,
    tournamentName: tournament.title,
    tournamentType: "Group Stage",
    sportSelections: [
      { sportId: sport._id, sportName: "Carrom", categoryName: "Open", fee: FEE },
    ],
    totalFee: FEE,
    paymentAmount: FEE,
    // Stamp the owning tenant. In production the tenantScope plugin does this
    // from the request's tenant context; created directly here, the booking
    // would otherwise be invisible to the manager's tenant-scoped reads.
    clubId: clubAdminId,
  });

  return { manager, player, sport, tournament, booking };
}

function submitProof(player, body, { attachScreenshot = true } = {}) {
  const req = request(app)
    .post("/api/payments/proofs")
    .set("Authorization", `Bearer ${playerToken(player._id)}`);

  for (const [k, v] of Object.entries(body)) {
    req.field(k, String(v));
  }
  if (attachScreenshot) {
    // A 1x1 PNG — enough to exercise the multer path and the image filter.
    const png = Buffer.from(
      "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
        "01f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082",
      "hex"
    );
    req.attach("screenshot", png, "proof.png");
  }
  return req;
}

describe("the proof workflow is reachable (§2.5)", () => {
  test("a player can submit a proof and it lands in the manager's inbox", async () => {
    const { manager, player, tournament, booking } = await seed();

    // Before: the inbox is empty — as it always was.
    const before = await request(app)
      .get(`/api/payments/proofs/pending/${manager._id}`)
      .set("Authorization", `Bearer ${mgrToken(manager._id)}`);
    expect(before.status).toBe(200);
    expect(before.body.data).toHaveLength(0);

    const res = await submitProof(player, {
      tournamentId: String(tournament._id),
      paymentMethod: "upi",
      transactionId: "UPI-REF-AAA-111",
    });
    expect(res.status).toBe(201);

    // After: the manager actually has something to review.
    const after = await request(app)
      .get(`/api/payments/proofs/pending/${manager._id}`)
      .set("Authorization", `Bearer ${mgrToken(manager._id)}`);
    expect(after.status).toBe(200);
    expect(after.body.data).toHaveLength(1);
    expect(after.body.data[0].transactionId).toBe("UPI-REF-AAA-111");
    expect(String(after.body.data[0].bookingId)).toBe(String(booking._id));
  });

  test("the proof carries the amount it is evidence for (§7.4)", async () => {
    const { player, tournament } = await seed();

    await submitProof(player, {
      tournamentId: String(tournament._id),
      paymentMethod: "upi",
      transactionId: "UPI-REF-AMOUNT",
    });

    const proof = await PlayerPayment.findOne({ transactionId: "UPI-REF-AMOUNT" }).lean();
    // Previously the review document had no monetary value at all — a manager
    // approved a payment of unknown size against a screenshot.
    expect(proof.amount).toBe(FEE);
  });

  test("managerId is taken from the tournament, not the request body", async () => {
    const { manager, player, tournament } = await seed();
    const impostor = await Manager.create({
      name: "Impostor",
      email: `imp-${Date.now()}@test.local`,
      password: "x",
      mobile: "9777777777",
      clubId: new mongoose.Types.ObjectId(),
    });

    await submitProof(player, {
      tournamentId: String(tournament._id),
      paymentMethod: "upi",
      transactionId: "UPI-REF-MGR",
      managerId: String(impostor._id), // ← ignored
    });

    const proof = await PlayerPayment.findOne({ transactionId: "UPI-REF-MGR" }).lean();
    expect(String(proof.managerId)).toBe(String(manager._id));
    expect(String(proof.managerId)).not.toBe(String(impostor._id));
  });

  test("playerId is taken from the token, not the request body", async () => {
    const { player, tournament } = await seed();
    const victim = await User.create({
      name: "Victim",
      email: `victim-${Date.now()}@test.local`,
      password: "x",
      role: "Player",
      dateOfBirth: new Date("1995-01-01"),
      sex: "male",
      mobile: "9666666666",
    });

    await submitProof(player, {
      tournamentId: String(tournament._id),
      paymentMethod: "upi",
      transactionId: "UPI-REF-PLAYER",
      playerId: String(victim._id), // ← ignored
    });

    const proof = await PlayerPayment.findOne({ transactionId: "UPI-REF-PLAYER" }).lean();
    expect(String(proof.playerId)).toBe(String(player._id));
  });

  test("submitting without a registration is refused", async () => {
    const { tournament } = await seed();
    const stranger = await User.create({
      name: "Stranger",
      email: `stranger-${Date.now()}@test.local`,
      password: "x",
      role: "Player",
      dateOfBirth: new Date("1995-01-01"),
      sex: "male",
      mobile: "9555555555",
    });

    const res = await submitProof(stranger, {
      tournamentId: String(tournament._id),
      paymentMethod: "upi",
      transactionId: "UPI-REF-NOBOOKING",
    });

    expect(res.status).toBe(404);
    expect(await PlayerPayment.countDocuments({})).toBe(0);
  });

  test("anonymous submission is refused", async () => {
    const { tournament } = await seed();
    const res = await request(app)
      .post("/api/payments/proofs")
      .field("tournamentId", String(tournament._id))
      .field("paymentMethod", "upi")
      .field("transactionId", "UPI-REF-ANON");

    expect([401, 403]).toContain(res.status);
  });

  test("a UPI reference cannot back two live proofs (§7.4)", async () => {
    const { player, tournament } = await seed();

    const first = await submitProof(player, {
      tournamentId: String(tournament._id),
      paymentMethod: "upi",
      transactionId: "UPI-REF-DUPLICATE",
    });
    expect(first.status).toBe(201);

    const second = await submitProof(player, {
      tournamentId: String(tournament._id),
      paymentMethod: "upi",
      transactionId: "UPI-REF-DUPLICATE",
    });
    expect(second.status).toBe(409);
    expect(await PlayerPayment.countDocuments({})).toBe(1);
  });
});

describe("approving a proof confirms the booking (§2.5 end to end)", () => {
  test("the full submit → review → verify → confirmed loop works", async () => {
    const { manager, player, tournament, booking } = await seed();

    const submitted = await submitProof(player, {
      tournamentId: String(tournament._id),
      paymentMethod: "upi",
      transactionId: "UPI-REF-E2E",
    });
    expect(submitted.status).toBe(201);
    const proofId = submitted.body.data._id;

    expect((await Booking.findById(booking._id)).paymentStatus).toBe("pending");

    const verified = await request(app)
      .patch(`/api/payments/proofs/${proofId}/verify`)
      .set("Authorization", `Bearer ${mgrToken(manager._id)}`)
      .send({ status: "approved" });

    expect(verified.status).toBe(200);
    const after = await Booking.findById(booking._id).lean();
    expect(after.status).toBe("confirmed");
    expect(after.paymentStatus).toBe("paid");
  });

  test("a manager cannot verify a proof submitted to someone else", async () => {
    const { player, tournament } = await seed();
    const other = await Manager.create({
      name: "Other Manager",
      email: `other-${Date.now()}@test.local`,
      password: "x",
      mobile: "9444444444",
      clubId: new mongoose.Types.ObjectId(),
    });

    const submitted = await submitProof(player, {
      tournamentId: String(tournament._id),
      paymentMethod: "upi",
      transactionId: "UPI-REF-FOREIGN",
    });
    const proofId = submitted.body.data._id;

    const res = await request(app)
      .patch(`/api/payments/proofs/${proofId}/verify`)
      .set("Authorization", `Bearer ${mgrToken(other._id)}`)
      .send({ status: "approved" });

    expect(res.status).toBe(403);
  });
});

describe("proof screenshots are not public (§2.2 + §2.5)", () => {
  test("payment-proofs is a private uploads directory", () => {
    const { PRIVATE_DIRS, PUBLIC_DIRS } = require("../../middleware/serveUploads");
    expect(PRIVATE_DIRS).toContain("payment-proofs");
    expect(PUBLIC_DIRS).not.toContain("payment-proofs");
  });

  test("an anonymous request for a proof screenshot is refused", async () => {
    const res = await request(app).get("/uploads/payment-proofs/screenshot-1-abc.png");
    expect(res.status).not.toBe(200);
  });
});

describe("player contact details come from the account (§5.4)", () => {
  test("placeholder email/phone in the request body are ignored", async () => {
    const { player, tournament, sport } = await seed();
    await Booking.deleteMany({ userId: player._id });

    // Seed the RBAC grant the register route requires.
    const Role = require("../../src/modules/identity/models/Role");
    const Permission = require("../../src/modules/identity/models/Permission");
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
        // The placeholders the mobile app used to send.
        userEmail: "player@example.com",
        userPhone: "N/A",
        sportSelections: [
          { sportId: String(sport._id), sportName: "Carrom", categoryName: "Open" },
        ],
      });

    expect(res.status).toBeLessThan(400);

    const booking = await Booking.findOne({ userId: player._id }).lean();
    // The manager sees the player's real, account-backed contact details.
    expect(booking.userEmail).toBe(player.email);
    expect(booking.userEmail).not.toBe("player@example.com");
    expect(booking.userPhone).toBe(player.mobile);
    expect(booking.userPhone).not.toBe("N/A");
  });
});
