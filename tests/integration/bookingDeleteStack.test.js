"use strict";
/**
 * The manager's delete stack — deleting a registration is recoverable, and the
 * inbox shows one row per registration.
 *
 * Two problems this covers, both found in live data:
 *
 *  1. There was no way to delete a tournament registration at all. The only
 *     booking DELETE route in the codebase is /api/club/bookings/:bookingId,
 *     which removes a ClubBooking (a court slot) — a different model. A manager
 *     pressing "Decline" only set status: "cancelled"; the row stayed forever.
 *
 *  2. /notify created a NEW notification per call, so a retried registration
 *     left several identical rows for one (tournament, player) pair — 8 such
 *     pairs in production, one of them 7 rows deep. Accepting one left the rest
 *     pending, because updateBookingStatus matched a single arbitrary row.
 *
 * Deleting is destructive, so the test that matters most is the round trip:
 * what comes back out of the bin must be what went in, same _id and all.
 */

const request = require("supertest");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { startTxApp, stopTxApp, clearDatabase } = require("./setupReplset");

const Tournament = require("../../src/modules/tournaments/models/Tournament");
const Sport = require("../../src/modules/catalog/models/Sport");
const Booking = require("../../src/modules/tournaments/models/BookingModel");
const Notification = require("../../src/modules/social/models/Notification");
const DeleteStack = require("../../src/modules/tournaments/models/DeleteStack");
const User = require("../../src/modules/identity/models/User");
const { Manager } = require("../../src/modules/identity/models/ClubManager");
const { purgeEndedDeleteStackEntries } = require("../../cron/deleteStackPurgeCron");

let app;
const FEE = 400;

beforeAll(async () => {
  app = await startTxApp();
});
afterAll(stopTxApp);
beforeEach(clearDatabase);

const mgrToken = (id) =>
  jwt.sign({ id: String(id), role: "Manager" }, process.env.JWT_SECRET, { expiresIn: "1h" });
const playerToken = (id) =>
  jwt.sign({ id: String(id), role: "Player" }, process.env.JWT_SECRET, { expiresIn: "1h" });

let seq = 0;
async function makeManager(name) {
  seq += 1;
  return Manager.create({
    name,
    email: `mgr-${seq}-${Date.now()}@test.local`,
    password: "hashed-not-used",
    mobile: `98888888${String(seq).padStart(2, "0")}`,
    clubId: new mongoose.Types.ObjectId(),
  });
}

async function makePlayer(name) {
  seq += 1;
  return User.create({
    name,
    email: `player-${seq}-${Date.now()}@test.local`,
    password: "hashed-not-used",
    role: "Player",
    dateOfBirth: new Date("1995-01-01"),
    sex: "male",
    mobile: `99999999${String(seq).padStart(2, "0")}`,
  });
}

/** A manager running one tournament, with `playerCount` players registered. */
async function seed(playerCount = 1) {
  const manager = await makeManager("Stack Manager");
  const sport = await Sport.create({ name: "Table Tennis", category: "Racquet", scoringType: "sets" });
  const tournament = await Tournament.create({
    title: "Monthly League",
    startDate: new Date("2030-01-01"),
    endDate: new Date("2030-01-02"),
    managerId: [manager._id],
    clubId: manager.clubId,
    sports: [
      {
        sportId: sport._id,
        sportName: "Table Tennis",
        tournamentLevel: "unranked",
        categories: [{ name: "Men's Open", fee: FEE }],
      },
    ],
  });

  const players = [];
  for (let i = 0; i < playerCount; i++) {
    const player = await makePlayer(`Player ${i + 1}`);
    const booking = await Booking.create({
      userId: player._id,
      userName: player.name,
      tournamentId: tournament._id,
      tournamentName: tournament.title,
      tournamentType: "Group Stage",
      sportSelections: [
        { sportId: sport._id, sportName: "Table Tennis", categoryName: "Men's Open", fee: FEE },
      ],
      totalFee: FEE,
      paymentAmount: FEE,
      clubId: manager.clubId,
    });
    const notification = await Notification.create({
      managerId: manager._id,
      tournamentId: tournament._id,
      userId: player._id,
      registrationId: `reg_${Date.now()}_${i}`,
      amount: FEE,
      paymentMethod: "cash",
      message: `${player.name} registered for "${tournament.title}" via cash (₹${FEE})`,
    });
    players.push({ player, booking, notification });
  }

  return { manager, sport, tournament, players };
}

const del = (manager, body) =>
  request(app)
    .post("/api/payments/booking/delete")
    .set("Authorization", `Bearer ${mgrToken(manager._id)}`)
    .send(body);

const restore = (manager, entryIds) =>
  request(app)
    .post("/api/payments/booking/restore")
    .set("Authorization", `Bearer ${mgrToken(manager._id)}`)
    .send({ entryIds });

const purge = (manager, entryIds) =>
  request(app)
    .post("/api/payments/booking/purge")
    .set("Authorization", `Bearer ${mgrToken(manager._id)}`)
    .send({ entryIds });

const bin = (manager) =>
  request(app)
    .get(`/api/payments/${manager._id}/trash`)
    .set("Authorization", `Bearer ${mgrToken(manager._id)}`);

const inbox = (manager) =>
  request(app)
    .get(`/api/payments/${manager._id}/notifications`)
    .set("Authorization", `Bearer ${mgrToken(manager._id)}`);

describe("deleting a registration", () => {
  test("removes the booking AND its notification, and banks both in the delete stack", async () => {
    const { manager, tournament, players } = await seed(1);
    const { player, booking } = players[0];

    const res = await del(manager, {
      items: [{ tournamentId: tournament._id, userId: player._id }],
      reason: "duplicate entry",
    });

    expect(res.status).toBe(200);
    expect(res.body.deletedCount).toBe(1);
    expect(res.body.skipped).toHaveLength(0);

    expect(await Booking.countDocuments({ _id: booking._id })).toBe(0);
    expect(await Notification.countDocuments({ tournamentId: tournament._id, userId: player._id })).toBe(0);

    const entry = await DeleteStack.findById(res.body.entries[0].entryId).lean();
    expect(entry.entryType).toBe("registration");
    expect(entry.bookings).toHaveLength(1);
    expect(entry.notifications).toHaveLength(1);
    expect(entry.reason).toBe("duplicate entry");
    expect(String(entry.deletedBy)).toBe(String(manager._id));
    // The title is snapshotted: a later rename must not rewrite history.
    expect(entry.tournamentTitle).toBe("Monthly League");
  });

  test("deletes many in one request and leaves everyone else registered", async () => {
    const { manager, tournament, players } = await seed(3);

    const res = await del(manager, {
      items: players.slice(0, 2).map((p) => ({ tournamentId: tournament._id, userId: p.player._id })),
    });

    expect(res.body.deletedCount).toBe(2);
    const left = await Booking.find({ tournamentId: tournament._id }).lean();
    expect(left).toHaveLength(1);
    expect(String(left[0].userId)).toBe(String(players[2].player._id));
  });

  test("a manager who does not run the tournament changes nothing", async () => {
    const { tournament, players } = await seed(1);
    const impostor = await makeManager("Impostor");

    const res = await del(impostor, {
      items: [{ tournamentId: tournament._id, userId: players[0].player._id }],
    });

    expect(res.status).toBe(403);
    expect(await Booking.countDocuments({ tournamentId: tournament._id })).toBe(1);
    expect(await DeleteStack.countDocuments({})).toBe(0);
  });

  test("one foreign tournament in a batch rejects the whole batch", async () => {
    const mine = await seed(1);
    const theirs = await seed(1);

    const res = await del(mine.manager, {
      items: [
        { tournamentId: mine.tournament._id, userId: mine.players[0].player._id },
        { tournamentId: theirs.tournament._id, userId: theirs.players[0].player._id },
      ],
    });

    expect(res.status).toBe(403);
    // Not even the half they were entitled to delete.
    expect(await Booking.countDocuments({})).toBe(2);
  });
});

describe("the delete stack", () => {
  test("lists only the deleting manager's own entries", async () => {
    const { manager, tournament, players } = await seed(1);
    const other = await makeManager("Other");

    await del(manager, { items: [{ tournamentId: tournament._id, userId: players[0].player._id }] });

    const mine = await bin(manager);
    expect(mine.body.entries).toHaveLength(1);
    expect(mine.body.entries[0].userName).toBe("Player 1");

    const theirs = await bin(other);
    expect(theirs.body.entries).toHaveLength(0);
  });

  test("restores the booking and the notification exactly as they were", async () => {
    const { manager, tournament, players } = await seed(1);
    const { player, booking, notification } = players[0];
    const original = await Booking.findById(booking._id).lean();

    const deleted = await del(manager, {
      items: [{ tournamentId: tournament._id, userId: player._id }],
    });
    const entryId = deleted.body.entries[0].entryId;

    const res = await restore(manager, [entryId]);
    expect(res.body.restoredCount).toBe(1);

    const back = await Booking.findById(booking._id).lean();
    expect(back).toBeTruthy();
    // Same document, not a re-created lookalike.
    expect(back).toEqual(original);
    expect(await Notification.countDocuments({ _id: notification._id })).toBe(1);

    const entry = await DeleteStack.findById(entryId).lean();
    expect(entry.status).toBe("restored");
    expect(entry.restoredAt).toBeTruthy();
  });

  test("will not restore over a player who registered again", async () => {
    const { manager, sport, tournament, players } = await seed(1);
    const { player } = players[0];

    const deleted = await del(manager, {
      items: [{ tournamentId: tournament._id, userId: player._id }],
    });
    const entryId = deleted.body.entries[0].entryId;

    // The player signs up again after the manager cleared them out.
    await Booking.create({
      userId: player._id,
      userName: player.name,
      tournamentId: tournament._id,
      tournamentName: tournament.title,
      tournamentType: "Group Stage",
      sportSelections: [
        { sportId: sport._id, sportName: "Table Tennis", categoryName: "Men's Open", fee: FEE },
      ],
      totalFee: FEE,
      paymentAmount: FEE,
      clubId: manager.clubId,
    });

    const res = await restore(manager, [entryId]);
    expect(res.body.restoredCount).toBe(0);
    expect(res.body.skipped[0].reason).toMatch(/registered again/i);
    // One booking, not two.
    expect(await Booking.countDocuments({ tournamentId: tournament._id, userId: player._id })).toBe(1);
    // Still recoverable — the entry stays in the bin.
    expect((await DeleteStack.findById(entryId)).status).toBe("deleted");
  });

  test("a manager cannot restore another manager's entry", async () => {
    const { manager, tournament, players } = await seed(1);
    const impostor = await makeManager("Impostor");

    const deleted = await del(manager, {
      items: [{ tournamentId: tournament._id, userId: players[0].player._id }],
    });
    const entryId = deleted.body.entries[0].entryId;

    const res = await restore(impostor, [entryId]);
    expect(res.body.restoredCount).toBe(0);
    expect(await Booking.countDocuments({ tournamentId: tournament._id })).toBe(0);
  });
});

describe("one registration is one inbox row", () => {
  test("notifying twice does not create a second row", async () => {
    const { manager, tournament, players } = await seed(1);
    const { player } = players[0];
    await Notification.deleteMany({}); // start from the player's first notify

    const notify = () =>
      request(app)
        .post(`/api/payments/${manager._id}/${tournament._id}/notify`)
        .set("Authorization", `Bearer ${playerToken(player._id)}`)
        .send({ userId: player._id, paymentMethod: "cash" });

    const first = await notify();
    expect(first.body.alreadyNotified).toBe(false);

    const second = await notify();
    expect(second.body.alreadyNotified).toBe(true);
    expect(second.body.notificationId).toBe(first.body.notificationId);

    expect(await Notification.countDocuments({ tournamentId: tournament._id, userId: player._id })).toBe(1);
  });

  test("a re-notify does not reopen a registration the manager already decided", async () => {
    const { manager, tournament, players } = await seed(1);
    const { player } = players[0];

    await Notification.updateMany({}, { $set: { transactionStatus: "accepted" } });

    await request(app)
      .post(`/api/payments/${manager._id}/${tournament._id}/notify`)
      .set("Authorization", `Bearer ${playerToken(player._id)}`)
      .send({ userId: player._id, paymentMethod: "cash" });

    const rows = await Notification.find({ tournamentId: tournament._id, userId: player._id }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].transactionStatus).toBe("accepted");
  });

  test("legacy duplicate rows are collapsed into one, carrying the count", async () => {
    const { manager, tournament, players } = await seed(1);
    const { player } = players[0];

    // Two more rows of the kind /notify used to mint on every call.
    for (let i = 0; i < 2; i++) {
      await Notification.create({
        managerId: manager._id,
        tournamentId: tournament._id,
        userId: player._id,
        registrationId: `reg_legacy_${i}`,
        amount: FEE,
        paymentMethod: "cash",
        message: `${player.name} registered for "${tournament.title}" via cash (₹${FEE})`,
      });
    }
    expect(await Notification.countDocuments({})).toBe(3);

    const res = await inbox(manager);
    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.notifications[0].duplicateCount).toBe(3);
    expect(res.body.notifications[0].hasBooking).toBe(true);
  });

  test("deleting a collapsed row clears every duplicate behind it", async () => {
    const { manager, tournament, players } = await seed(1);
    const { player } = players[0];

    for (let i = 0; i < 2; i++) {
      await Notification.create({
        managerId: manager._id,
        tournamentId: tournament._id,
        userId: player._id,
        registrationId: `reg_legacy_${i}`,
        amount: FEE,
        paymentMethod: "cash",
        message: "duplicate",
      });
    }

    const res = await del(manager, {
      items: [{ tournamentId: tournament._id, userId: player._id }],
    });

    expect(res.body.entries[0].notifications).toBe(3);
    expect(await Notification.countDocuments({})).toBe(0);
    // And all three come back together.
    await restore(manager, [res.body.entries[0].entryId]);
    expect(await Notification.countDocuments({})).toBe(3);
  });

  test("an inbox row whose booking is gone is flagged, and deleting it clears just the row", async () => {
    const { manager, tournament, players } = await seed(1);
    const { player, booking } = players[0];
    await Booking.deleteOne({ _id: booking._id }); // the orphan case, 48 of them live

    const listed = await inbox(manager);
    expect(listed.body.notifications[0].hasBooking).toBe(false);

    const res = await del(manager, {
      items: [{ tournamentId: tournament._id, userId: player._id }],
    });
    expect(res.body.deletedCount).toBe(1);

    const entry = await DeleteStack.findById(res.body.entries[0].entryId).lean();
    expect(entry.entryType).toBe("notification");
    expect(entry.bookings).toHaveLength(0);
    expect(entry.notifications).toHaveLength(1);
  });
});

describe("emptying the bin", () => {
  test("permanent delete removes the entry for good", async () => {
    const { manager, tournament, players } = await seed(1);
    const deleted = await del(manager, {
      items: [{ tournamentId: tournament._id, userId: players[0].player._id }],
    });
    const entryId = deleted.body.entries[0].entryId;

    const res = await purge(manager, [entryId]);
    expect(res.body.purgedCount).toBe(1);
    expect(await DeleteStack.findById(entryId)).toBeNull();
    // The snapshot is gone, so the booking cannot come back.
    const after = await restore(manager, [entryId]);
    expect(after.body.restoredCount).toBe(0);
  });

  test("a manager cannot purge another manager's entry", async () => {
    const { manager, tournament, players } = await seed(1);
    const impostor = await makeManager("Impostor");
    const deleted = await del(manager, {
      items: [{ tournamentId: tournament._id, userId: players[0].player._id }],
    });
    const entryId = deleted.body.entries[0].entryId;

    const res = await purge(impostor, [entryId]);
    expect(res.body.purgedCount).toBe(0);
    expect(await DeleteStack.findById(entryId)).toBeTruthy();
  });
});

describe("the automatic sweep", () => {
  // The bin's safety net is only needed while the tournament is live. Once it
  // has finished, nobody restores a registration into it.
  test("clears entries whose tournament has ended", async () => {
    const { manager, tournament, players } = await seed(1);
    const deleted = await del(manager, {
      items: [{ tournamentId: tournament._id, userId: players[0].player._id }],
    });
    const entryId = deleted.body.entries[0].entryId;

    // Seeded tournaments end 2030-01-02; nothing to do before then.
    expect(await purgeEndedDeleteStackEntries(new Date("2029-12-31"))).toBe(0);
    expect(await DeleteStack.findById(entryId)).toBeTruthy();

    // Not even on the final day itself — the deadline is the end of it.
    expect(await purgeEndedDeleteStackEntries(new Date("2030-01-02T12:00:00Z"))).toBe(0);
    expect(await DeleteStack.findById(entryId)).toBeTruthy();

    expect(await purgeEndedDeleteStackEntries(new Date("2030-01-03T04:00:00Z"))).toBe(1);
    expect(await DeleteStack.findById(entryId)).toBeNull();
  });

  test("leaves a restored entry alone", async () => {
    const { manager, tournament, players } = await seed(1);
    const deleted = await del(manager, {
      items: [{ tournamentId: tournament._id, userId: players[0].player._id }],
    });
    const entryId = deleted.body.entries[0].entryId;
    await restore(manager, [entryId]);

    expect(await purgeEndedDeleteStackEntries(new Date("2031-01-01"))).toBe(0);
    expect((await DeleteStack.findById(entryId)).status).toBe("restored");
  });

  test("never touches an entry whose end date could not be read", async () => {
    const { manager, tournament, players } = await seed(1);
    // Tournament deleted first, so there is no end date to snapshot.
    await Tournament.deleteOne({ _id: tournament._id });
    const deleted = await del(manager, {
      items: [{ tournamentId: tournament._id, userId: players[0].player._id }],
    });
    const entry = await DeleteStack.findById(deleted.body.entries[0].entryId);
    expect(entry.tournamentEndDate).toBeNull();

    // Far future — an entry with no deadline must still be there.
    expect(await purgeEndedDeleteStackEntries(new Date("2099-01-01"))).toBe(0);
    expect(await DeleteStack.findById(entry._id)).toBeTruthy();

    // It is the manager's to clear by hand.
    const res = await purge(manager, [entry._id]);
    expect(res.body.purgedCount).toBe(1);
  });

  test("the deadline is snapshotted, so re-dating the tournament cannot move it", async () => {
    const { manager, tournament, players } = await seed(1);
    const deleted = await del(manager, {
      items: [{ tournamentId: tournament._id, userId: players[0].player._id }],
    });
    const entryId = deleted.body.entries[0].entryId;

    // Someone pushes the tournament out by a decade after the delete.
    await Tournament.updateOne({ _id: tournament._id }, { $set: { endDate: new Date("2040-01-01") } });

    expect(await purgeEndedDeleteStackEntries(new Date("2030-01-03T04:00:00Z"))).toBe(1);
    expect(await DeleteStack.findById(entryId)).toBeNull();
  });

  test("a string endDate is understood, not silently skipped", async () => {
    // The live SEP 6TH tournament stores endDate as "2026-09-06", not a Date.
    const { manager, tournament, players } = await seed(1);
    await Tournament.collection.updateOne(
      { _id: tournament._id },
      { $set: { endDate: "2030-01-02" } }
    );

    const deleted = await del(manager, {
      items: [{ tournamentId: tournament._id, userId: players[0].player._id }],
    });
    const entry = await DeleteStack.findById(deleted.body.entries[0].entryId);
    expect(entry.tournamentEndDate).toBeTruthy();

    expect(await purgeEndedDeleteStackEntries(new Date("2030-01-01"))).toBe(0);
    expect(await purgeEndedDeleteStackEntries(new Date("2030-01-03T04:00:00Z"))).toBe(1);
  });
});

describe("rows left behind by a deleted tournament", () => {
  // 16 of the 21 tournaments in one live inbox no longer exist. Their rows
  // stay forever, and the ownership check cannot ask a document that is gone
  // whether the caller managed it — the notification answers instead.
  test("the manager the notification was addressed to can clear them", async () => {
    const { manager, tournament, players } = await seed(1);
    const { player } = players[0];
    await Tournament.deleteOne({ _id: tournament._id });

    const res = await del(manager, {
      items: [{ tournamentId: tournament._id, userId: player._id }],
    });

    expect(res.status).toBe(200);
    expect(res.body.deletedCount).toBe(1);
    expect(await Notification.countDocuments({})).toBe(0);

    // The tournament's title died with it; the message kept a copy.
    const entry = await DeleteStack.findById(res.body.entries[0].entryId).lean();
    expect(entry.tournamentTitle).toBe("Monthly League");
    // Still restorable, even though the tournament will never come back.
    await restore(manager, [entry._id]);
    expect(await Notification.countDocuments({})).toBe(1);
  });

  test("a manager with no notification for it is still refused", async () => {
    const { tournament, players } = await seed(1);
    const impostor = await makeManager("Impostor");
    await Tournament.deleteOne({ _id: tournament._id });

    const res = await del(impostor, {
      items: [{ tournamentId: tournament._id, userId: players[0].player._id }],
    });

    expect(res.status).toBe(403);
    expect(await Notification.countDocuments({})).toBe(1);
    expect(await Booking.countDocuments({})).toBe(1);
  });

  test("one manager clearing a dead row leaves a co-manager's copy alone", async () => {
    const { manager, tournament, players } = await seed(1);
    const coManager = await makeManager("Co-manager");
    const { player } = players[0];

    // The same registration, announced to a second manager of the tournament.
    await Notification.create({
      managerId: coManager._id,
      tournamentId: tournament._id,
      userId: player._id,
      registrationId: "reg_co_manager",
      amount: FEE,
      paymentMethod: "cash",
      message: `${player.name} registered for "Monthly League" via cash (₹${FEE})`,
    });
    await Tournament.deleteOne({ _id: tournament._id });

    await del(manager, { items: [{ tournamentId: tournament._id, userId: player._id }] });

    const left = await Notification.find({}).lean();
    expect(left).toHaveLength(1);
    expect(String(left[0].managerId)).toBe(String(coManager._id));
  });
});
