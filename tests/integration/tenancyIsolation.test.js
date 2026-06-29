"use strict";
/**
 * Phase 1 — cross-tenant isolation proofs (Tasks 1 & 2).
 *
 *  Test 1: Club A cannot read Club B's data on an enforced Phase-1 model.
 *  Test 2: Club A cannot read Club B's data through an aggregate pipeline.
 *
 * Both run against the REAL Student model (enforced in Phase 1) on an isolated
 * in-memory MongoDB, inside real tenant contexts via runWithTenant — exactly how
 * the auth middleware establishes context per request.
 */
const mongoose = require("mongoose");
const { startTestApp, stopTestApp, clearDatabase } = require("./setup");
const { runWithTenant, tenantMatchStage } = require("../../utils/tenantContext");

const Student = require("../../src/modules/coaching/models/Student");

const clubA = new mongoose.Types.ObjectId();
const clubB = new mongoose.Types.ObjectId();
const ctxA = { clubId: String(clubA), principalType: "ClubAdmin" };
const ctxB = { clubId: String(clubB), principalType: "ClubAdmin" };

beforeAll(async () => {
  await startTestApp();
});
afterAll(stopTestApp);

beforeEach(async () => {
  await clearDatabase();
  // Raw insert (bypass schema validation) — 3 students for A, 2 for B.
  await Student.collection.insertMany([
    { clubId: clubA, standard: "V", name: "A1" },
    { clubId: clubA, standard: "V", name: "A2" },
    { clubId: clubA, standard: "VI", name: "A3" },
    { clubId: clubB, standard: "V", name: "B1" },
    { clubId: clubB, standard: "VI", name: "B2" },
  ]);
});

test("Test 1 — Club A cannot read Club B's documents (find/count are scoped)", async () => {
  // Club A context: sees only its own 3, never B's. (await INSIDE runWithTenant
  // so the query executes while the tenant context is active.)
  const aDocs = await runWithTenant(ctxA, async () => Student.find({}).lean());
  expect(aDocs).toHaveLength(3);
  expect(aDocs.every((d) => String(d.clubId) === String(clubA))).toBe(true);

  // Even an explicit attempt to read B's rows from A's context returns nothing.
  const leak = await runWithTenant(ctxA, async () =>
    Student.find({ standard: "V" }).lean()
  );
  expect(leak.every((d) => String(d.clubId) === String(clubA))).toBe(true);

  // Club B context: sees only its own 2.
  const bCount = await runWithTenant(ctxB, async () => Student.countDocuments({}));
  expect(bCount).toBe(2);

  // No tenant context (e.g. SuperAdmin/public path) sees all 5 — by design.
  const allCount = await Student.countDocuments({});
  expect(allCount).toBe(5);
});

test("Test 2 — Club A cannot read Club B's data via an aggregate pipeline", async () => {
  const countFor = (ctx) =>
    runWithTenant(ctx, () =>
      Student.aggregate([
        ...tenantMatchStage(), // the Phase-1 aggregate scope guard
        { $group: { _id: null, count: { $sum: 1 } } },
      ])
    );

  const [aAgg] = await countFor(ctxA);
  const [bAgg] = await countFor(ctxB);
  expect(aAgg.count).toBe(3); // only A's rows
  expect(bAgg.count).toBe(2); // only B's rows

  // Per-standard breakdown from A's context must never include B's "B1"/"B2".
  const aByStandard = await runWithTenant(ctxA, () =>
    Student.aggregate([
      ...tenantMatchStage(),
      { $group: { _id: "$standard", count: { $sum: 1 } } },
    ])
  );
  const total = aByStandard.reduce((s, r) => s + r.count, 0);
  expect(total).toBe(3); // not 5 — B's rows are invisible to A
});
