/**
 * Cross-tenant isolation suite (Phase 1.1 multi-tenancy).
 *
 * Proves the tenantScope plugin keeps one club's data invisible to another, on
 * the REAL enforced models, against an isolated in-memory MongoDB (never touches
 * your Atlas data).
 *
 * Run:
 *   npm install -D mongodb-memory-server   # one-time
 *   npm test
 *
 * What it asserts, for every enforced model:
 *   • a club-staff query returns ONLY that club's docs (no leakage)
 *   • no tenant context (player/public) sees ALL docs (cross-tenant by design)
 *   • SuperAdmin context sees ALL docs
 *   • updates/deletes are scoped to the caller's club
 * Plus the write path: clubId is stamped from context, and DERIVED from the
 * parent when a cross-tenant actor (player) creates a booking.
 */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { runWithTenant } = require("../utils/tenantContext");

const Tournament = require("../src/modules/tournaments/models/Tournament");
const Booking = require("../src/modules/tournaments/models/BookingModel");
const Payment = require("../src/modules/commerce/models/Payments");
const Match = require("../src/modules/tournaments/models/Tournnamentmatch"); // model "Match" — the live group-stage match collection
const Turf = require("../src/modules/org/models/Turf");
const TurfBooking = require("../src/modules/org/models/TurfBooking");

const clubA = new mongoose.Types.ObjectId();
const clubB = new mongoose.Types.ObjectId();
const ctxA = { clubId: String(clubA), principalType: "ClubAdmin" };
const ctxB = { clubId: String(clubB), principalType: "Manager" };
const ctxSA = { isSuperAdmin: true, principalType: "SuperAdmin" };

let mongod;

before(async () => {
  mongoose.set("autoIndex", false); // skip unique-index builds — irrelevant to scoping, avoids seed friction
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

after(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

// Insert raw docs (bypass schema validation) carrying only a clubId.
async function seed(Model, clubId, n) {
  const docs = Array.from({ length: n }, () => ({ clubId }));
  await Model.collection.insertMany(docs);
}

const ENFORCED = [
  { Model: Tournament, name: "Tournament" },
  { Model: Booking, name: "Booking" },
  { Model: Payment, name: "Payment" },
  { Model: Match, name: "Match" },
  { Model: Turf, name: "Turf" },
  { Model: TurfBooking, name: "TurfBooking" },
];

for (const { Model, name } of ENFORCED) {
  test(`${name}: club-staff queries are isolated; public/SuperAdmin see all`, async () => {
    await Model.collection.deleteMany({});
    await seed(Model, clubA, 3);
    await seed(Model, clubB, 2);

    // Club A staff → only A's 3
    const aCount = await runWithTenant(ctxA, async () => Model.countDocuments({}));
    assert.equal(aCount, 3, `${name}: club A should see exactly its 3 docs`);

    // Club B staff → only B's 2
    const bCount = await runWithTenant(ctxB, async () => Model.countDocuments({}));
    assert.equal(bCount, 2, `${name}: club B should see exactly its 2 docs`);

    // Zero leakage: nothing returned to A belongs to B
    const leaked = await runWithTenant(ctxA, async () => {
      const docs = await Model.find({}).select("clubId").lean();
      return docs.filter((d) => String(d.clubId) !== String(clubA)).length;
    });
    assert.equal(leaked, 0, `${name}: club A query leaked another club's docs`);

    // No tenant context (player/public) → all 5 (cross-tenant by design)
    const publicCount = await Model.countDocuments({});
    assert.equal(publicCount, 5, `${name}: public/no-context should see all docs`);

    // SuperAdmin → all 5
    const saCount = await runWithTenant(ctxSA, async () => Model.countDocuments({}));
    assert.equal(saCount, 5, `${name}: SuperAdmin should see all docs`);
  });

  test(`${name}: updates/deletes are scoped to the caller's club`, async () => {
    await Model.collection.deleteMany({});
    await seed(Model, clubA, 3);
    await seed(Model, clubB, 2);

    // Club A updates "everything" — must touch only A's docs.
    // strict:false so the throwaway marker isn't stripped (some models, e.g.
    // Payment, have no timestamps, so an all-stripped update would be a no-op).
    const upd = await runWithTenant(ctxA, async () =>
      Model.updateMany({}, { $set: { __touched: true } }, { strict: false })
    );
    assert.equal(upd.modifiedCount, 3, `${name}: club A update modified another club's docs`);
    const bTouched = await Model.countDocuments({ clubId: clubB, __touched: true });
    assert.equal(bTouched, 0, `${name}: club B docs were modified by club A`);

    // Club A deletes "everything" — must remove only A's docs
    const del = await runWithTenant(ctxA, async () => Model.deleteMany({}));
    assert.equal(del.deletedCount, 3, `${name}: club A delete removed another club's docs`);
    assert.equal(await Model.countDocuments({}), 2, `${name}: club B docs should survive A's delete`);
  });
}

test("Booking: clubId is stamped from the request context on create", async () => {
  await Booking.collection.deleteMany({});
  const b = await runWithTenant(ctxB, async () =>
    Booking.create({
      userName: "Ctx Player",
      tournamentId: new mongoose.Types.ObjectId(),
      tournamentName: "Ctx Cup",
      tournamentType: "knockout",
    })
  );
  assert.equal(String(b.clubId), String(clubB), "Booking should inherit clubId from the manager context");
});

test("Booking: clubId is DERIVED from the tournament when a player (no context) creates it", async () => {
  await Tournament.collection.deleteMany({});
  await Booking.collection.deleteMany({});
  const { insertedId: tid } = await Tournament.collection.insertOne({ clubId: clubA, title: "Derive Cup" });

  // No runWithTenant → simulates a cross-tenant player creating a booking.
  const b = await Booking.create({
    userName: "Player",
    tournamentId: tid,
    tournamentName: "Derive Cup",
    tournamentType: "knockout",
  });
  assert.equal(String(b.clubId), String(clubA), "Booking should derive clubId from its tournament");
});

test("TurfBooking: clubId is DERIVED from the turf when a player (no context) books", async () => {
  await Turf.collection.deleteMany({});
  await TurfBooking.collection.deleteMany({});
  const { insertedId: turfId } = await Turf.collection.insertOne({ clubId: clubB, name: "Derive Turf" });

  const tb = await TurfBooking.create({
    userId: new mongoose.Types.ObjectId(),
    userName: "Booker",
    turfId,
    turfName: "Derive Turf",
    sport: { name: "Football", pricePerHour: 500 },
    date: new Date("2026-07-01"),
    timeSlot: "18:00-19:00",
    amount: 500,
  });
  assert.equal(String(tb.clubId), String(clubB), "TurfBooking should derive clubId from its turf");
});
