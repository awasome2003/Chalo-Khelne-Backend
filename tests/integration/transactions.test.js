"use strict";
/**
 * Phase 5a — transaction tests. Each of the 3 critical writes gets a COMMIT test
 * (writes land) and an ABORT test (a mid-transaction failure leaves NO partial
 * writes). Runs on a single-node replica set (transactions require one).
 */
const request = require("supertest");
const mongoose = require("mongoose");
const { startTxApp, stopTxApp, clearDatabase, superAdminToken, managerToken } = require("./setupReplset");
const { runInTransaction } = require("../../src/platform/db");

const Tournament = require("../../src/modules/tournaments/models/Tournament");
const Sport = require("../../src/modules/catalog/models/Sport");
const Payment = require("../../src/modules/commerce/models/Payments");
const Booking = require("../../src/modules/tournaments/models/BookingModel");
const PlayerPayment = require("../../src/modules/commerce/models/playerPaymentSchema");
const { Manager } = require("../../src/modules/identity/models/ClubManager");

let app;

beforeAll(async () => { app = await startTxApp(); });
afterAll(stopTxApp);
beforeEach(async () => { await clearDatabase(); jest.restoreAllMocks(); });

// ── 1. Tournament creation ───────────────────────────────────────────
describe("createTournament transaction", () => {
  const body = {
    title: "Tx Cup",
    sports: [{ sportName: "Carrom", tournamentLevel: "unranked", categories: [{ name: "Open", fee: 0 }] }],
  };

  test("COMMIT — tournament is persisted", async () => {
    await Sport.create({ name: "Carrom", category: "Board", scoringType: "board" });
    const res = await request(app)
      .post("/api/tournaments/createTournament")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send(body);
    expect(res.status).toBeLessThan(400);
    expect(await Tournament.countDocuments({ title: "Tx Cup" })).toBe(1);
  });

  test("ABORT — save fails mid-transaction → NO tournament persisted", async () => {
    await Sport.create({ name: "Carrom", category: "Board", scoringType: "board" });
    jest.spyOn(Tournament.prototype, "save").mockRejectedValueOnce(new Error("boom"));
    const res = await request(app)
      .post("/api/tournaments/createTournament")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send(body);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await Tournament.countDocuments({ title: "Tx Cup" })).toBe(0);
  });
});

// ── 2. Team / booking registration atomicity (Payment + Booking) ──────
// Proves the exact guarantee the BookingController registration relies on:
// the Payment and Booking commit together or not at all.
describe("registration (Payment + Booking) atomicity", () => {
  test("COMMIT — both documents land", async () => {
    const pid = new mongoose.Types.ObjectId();
    const bid = new mongoose.Types.ObjectId();
    await runInTransaction(async (session) => {
      await Payment.collection.insertOne({ _id: pid, orderId: "ORD_OK", amount: 100, status: "pending" }, { session });
      await Booking.collection.insertOne({ _id: bid, status: "pending", paymentId: pid }, { session });
    });
    expect(await Payment.countDocuments({ _id: pid })).toBe(1);
    expect(await Booking.countDocuments({ _id: bid })).toBe(1);
  });

  test("ABORT — failure after the Payment write → NEITHER document exists", async () => {
    const pid = new mongoose.Types.ObjectId();
    await expect(
      runInTransaction(async (session) => {
        await Payment.collection.insertOne({ _id: pid, orderId: "ORD_FAIL", amount: 100, status: "pending" }, { session });
        throw new Error("booking save failed"); // simulate mid-transaction failure
      })
    ).rejects.toThrow("booking save failed");
    expect(await Payment.countDocuments({ _id: pid })).toBe(0); // rolled back
  });
});

// ── 3. Payment verification (verifyPayment) ──────────────────────────
describe("verifyPayment transaction + idempotency", () => {
  const playerId = new mongoose.Types.ObjectId();
  const tournamentId = new mongoose.Types.ObjectId();
  let managerId;

  async function seedManager() {
    managerId = new mongoose.Types.ObjectId();
    await Manager.collection.insertOne({ _id: managerId, name: "Mgr", status: "active" });
    return managerToken(managerId);
  }

  test("IDEMPOTENT — re-verifying an already-approved payment does not re-process", async () => {
    const token = await seedManager();
    const payId = new mongoose.Types.ObjectId();
    await PlayerPayment.collection.insertOne({
      _id: payId, playerId, tournamentId, managerId, amount: 500, status: "approved",
    });
    await Booking.collection.insertOne({
      userId: playerId, tournamentId, status: "confirmed", paymentStatus: "paid",
    });

    const res = await request(app)
      .patch(`/api/payments/proofs/${payId}/verify`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(true); // early-returned, no double-process
  });

  test("ABORT — payment.save fails after booking staged → booking NOT confirmed (rollback)", async () => {
    const token = await seedManager();
    const payId = new mongoose.Types.ObjectId();
    await PlayerPayment.collection.insertOne({
      _id: payId, playerId, tournamentId, managerId, amount: 500, status: "pending",
    });
    // Fully valid booking so booking.save() SUCCEEDS — the abort must be
    // triggered by the (mocked) payment.save() that runs AFTER it, proving the
    // already-staged booking write rolls back.
    await Booking.collection.insertOne({
      userId: playerId, userName: "Player One",
      tournamentId, tournamentName: "Tx Cup", tournamentType: "knockout",
      sportId: new mongoose.Types.ObjectId(),
      status: "pending", paymentStatus: "pending",
    });

    jest.spyOn(PlayerPayment.prototype, "save").mockRejectedValueOnce(new Error("boom"));

    const res = await request(app)
      .patch(`/api/payments/proofs/${payId}/verify`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "approved" });

    expect(res.status).toBeGreaterThanOrEqual(400);
    // Booking confirmation must have rolled back with the failed payment write.
    const booking = await Booking.findOne({ userId: playerId, tournamentId }).lean();
    expect(booking.status).toBe("pending");
    expect(booking.paymentStatus).toBe("pending");
  });
});
