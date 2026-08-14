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

// ── §3.9 — aggregate() is scoped STRUCTURALLY, not by convention ───────────
//
// Tests 1 and 2 above prove the manual tenantMatchStage() helper works. That
// helper appeared at only 10 of 27 aggregate() call sites; the other 17 were
// safe merely because they happened to constrain on an id list produced by a
// plugin-scoped query. Nothing failed when a new aggregate was added without
// the stage, and nothing tested for it.
//
// These assert the property the plugin now guarantees: a pipeline with NO
// manual tenant stage is still isolated.

test("§3.9 — an unguarded aggregate() is scoped by the plugin", async () => {
  // NOTE the `async` + `await`: the plugin's aggregate hook runs at exec time,
  // so the pipeline must be EXECUTED inside the tenant context — which is
  // exactly what a request handler does (`await Model.aggregate(...)` inside
  // the runWithTenant-wrapped request). Building the Aggregate inside the
  // context and awaiting it outside loses the AsyncLocalStorage store.
  const countFor = (ctx) =>
    runWithTenant(ctx, async () =>
      Student.aggregate([
        // Deliberately no tenantMatchStage() — this is the pattern that used to
        // leak across tenants.
        { $group: { _id: null, count: { $sum: 1 } } },
      ])
    );

  const [aAgg] = await countFor(ctxA);
  const [bAgg] = await countFor(ctxB);
  expect(aAgg.count).toBe(3);
  expect(bAgg.count).toBe(2);
});

test("§3.9 — an unguarded aggregate() never returns another tenant's rows", async () => {
  const rows = await runWithTenant(ctxA, async () =>
    Student.aggregate([{ $match: { standard: "V" } }, { $project: { name: 1, clubId: 1 } }])
  );
  expect(rows.every((r) => String(r.clubId) === String(clubA))).toBe(true);
  expect(rows.map((r) => r.name)).not.toContain("B1");
});

test("§3.9 — a hand-scoped pipeline is not double-matched", async () => {
  // The 10 existing tenantMatchStage() call sites must keep working unchanged.
  const rows = await runWithTenant(ctxA, async () =>
    Student.aggregate([...tenantMatchStage(), { $group: { _id: null, count: { $sum: 1 } } }])
  );
  expect(rows[0].count).toBe(3);
});

test("§3.9 — no tenant context still sees everything (SuperAdmin / public path)", async () => {
  const rows = await Student.aggregate([{ $group: { _id: null, count: { $sum: 1 } } }]);
  expect(rows[0].count).toBe(5);
});
