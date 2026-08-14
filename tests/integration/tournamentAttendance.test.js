"use strict";
/**
 * Tournament-day attendance / check-in.
 *
 * The problem: local tournaments in India routinely take 53 registrations and
 * see 16–25 players on the day. Draw generation has to run on who is PRESENT.
 * Nothing recorded presence, so the manager hand-ticked players into the
 * generation screen every time — in React state that did not survive a refresh,
 * with no record of who was absent, and no way to admit a walk-in who paid cash
 * at the desk (that screen filtered on payment status, not presence).
 *
 * The rules these tests pin:
 *   • presence is independent of payment — an unpaid player can be checked in;
 *   • attendance is per (sport, category) entry, not per person;
 *   • a player may only check THEMSELVES in, and only as present;
 *   • re-marking updates one row rather than accumulating history rows;
 *   • a walk-in is registered and checked in as a single action.
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
const TournamentAttendance = require("../../src/modules/tournaments/models/TournamentAttendance");
const { Manager } = require("../../src/modules/identity/models/ClubManager");

let app;
const FEE = 300;

beforeAll(async () => {
  app = await startTxApp();
  await TournamentAttendance.syncIndexes();
});
afterAll(stopTxApp);
beforeEach(async () => {
  await clearDatabase();
  await TournamentAttendance.syncIndexes();
});

function playerToken(userId) {
  return jwt.sign({ id: String(userId), role: "Player" }, process.env.JWT_SECRET, { expiresIn: "1h" });
}
function mgrToken(id) {
  return jwt.sign({ id: String(id), role: "Manager" }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

async function seedRbac() {
  const keys = [
    ["tournament:manage", "Manage tournament"],
    ["tournament:bulk_register", "Bulk register"],
  ];
  const perms = [];
  for (const [key, name] of keys) {
    perms.push(await Permission.create({ key, name, module: "tournament", action: key.split(":")[1] }));
  }
  await Role.create({
    name: "Manager",
    slug: "manager",
    authorityLevel: 2,
    permissions: perms.map((p) => p._id),
  });
}

async function seed({ registrations = 5 } = {}) {
  await seedRbac();

  const clubAdminId = new mongoose.Types.ObjectId();
  const manager = await Manager.create({
    name: "Desk Manager",
    email: `desk-${Date.now()}@test.local`,
    password: "x",
    mobile: "9800000000",
    clubId: clubAdminId,
  });

  const sport = await Sport.create({ name: "Table Tennis", category: "Racquet", scoringType: "sets" });
  const sport2 = await Sport.create({ name: "Carrom", category: "Board", scoringType: "board" });

  const tournament = await Tournament.create({
    title: "Local Open",
    startDate: new Date("2030-03-01"),
    endDate: new Date("2030-03-02"),
    managerId: [manager._id],
    clubId: clubAdminId,
    sports: [
      {
        sportId: sport._id,
        sportName: "Table Tennis",
        tournamentLevel: "unranked",
        categories: [
          { name: "Men's Singles", fee: FEE },
          { name: "Men's Doubles", fee: FEE },
        ],
      },
      {
        sportId: sport2._id,
        sportName: "Carrom",
        tournamentLevel: "unranked",
        categories: [{ name: "Open", fee: FEE }],
      },
    ],
  });

  // `registrations` players, all entered in Men's Singles.
  const players = [];
  for (let i = 0; i < registrations; i++) {
    const u = await User.create({
      name: `Player ${i + 1}`,
      email: `p${i}-${Date.now()}@test.local`,
      password: "x",
      role: "Player",
      dateOfBirth: new Date("1995-01-01"),
      sex: "male",
      mobile: `98000000${String(i).padStart(2, "0")}`,
    });
    const b = await Booking.create({
      userId: u._id,
      userName: u.name,
      tournamentId: tournament._id,
      tournamentName: tournament.title,
      tournamentType: "Group Stage",
      clubId: clubAdminId,
      // Half paid, half not — presence must not care.
      paymentStatus: i % 2 === 0 ? "paid" : "pending",
      totalFee: FEE,
      paymentAmount: FEE,
      sportSelections: [
        { sportId: sport._id, sportName: "Table Tennis", categoryName: "Men's Singles", fee: FEE },
      ],
    });
    players.push({ user: u, booking: b });
  }

  return { manager, tournament, sport, sport2, players, clubAdminId };
}

const MS = "Men's Singles";

function mark(manager, tournamentId, body) {
  return request(app)
    .post(`/api/tournaments/${tournamentId}/attendance/mark`)
    .set("Authorization", `Bearer ${mgrToken(manager._id)}`)
    .send(body);
}

function roster(manager, tournamentId, query = "") {
  return request(app)
    .get(`/api/tournaments/${tournamentId}/attendance${query}`)
    .set("Authorization", `Bearer ${mgrToken(manager._id)}`);
}

describe("roster", () => {
  test("lists every registration as unmarked before check-in starts", async () => {
    const { manager, tournament } = await seed({ registrations: 5 });

    const res = await roster(manager, tournament._id);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.summary).toMatchObject({ total: 5, checkedIn: 0, unmarked: 5 });
    // "Nobody marked yet" must be distinguishable from "everyone absent" —
    // the draw screens use exactly that difference.
    expect(res.body.data.every((r) => r.attendanceStatus === "registered")).toBe(true);
  });

  test("surfaces payment status without gating on it", async () => {
    const { manager, tournament } = await seed({ registrations: 4 });
    const res = await roster(manager, tournament._id);
    const unpaid = res.body.data.filter((r) => r.paymentStatus !== "paid");
    expect(unpaid.length).toBeGreaterThan(0);
    expect(unpaid[0].feeOwed).toBe(FEE);
  });

  test("one booking with three entries produces three roster rows", async () => {
    const { manager, tournament, sport, sport2, clubAdminId } = await seed({ registrations: 0 });
    const u = await User.create({
      name: "Multi Entrant",
      email: `multi-${Date.now()}@test.local`,
      password: "x",
      role: "Player",
      dateOfBirth: new Date("1995-01-01"),
      sex: "male",
      mobile: "9811111111",
    });
    await Booking.create({
      userId: u._id,
      userName: u.name,
      tournamentId: tournament._id,
      tournamentName: tournament.title,
      tournamentType: "Group Stage",
      clubId: clubAdminId,
      totalFee: FEE * 3,
      paymentAmount: FEE * 3,
      sportSelections: [
        { sportId: sport._id, sportName: "Table Tennis", categoryName: MS, fee: FEE },
        { sportId: sport._id, sportName: "Table Tennis", categoryName: "Men's Doubles", fee: FEE },
        { sportId: sport2._id, sportName: "Carrom", categoryName: "Open", fee: FEE },
      ],
    });

    const all = await roster(manager, tournament._id);
    expect(all.body.data).toHaveLength(3);

    // Narrowing to one sport+category gives exactly the desk's working list.
    const narrowed = await roster(
      manager,
      tournament._id,
      `?sportId=${sport._id}&categoryName=${encodeURIComponent(MS)}`
    );
    expect(narrowed.body.data).toHaveLength(1);
  });
});

describe("presence is independent of payment", () => {
  test("an UNPAID player can be checked in", async () => {
    const { manager, tournament, sport, players } = await seed({ registrations: 4 });
    const unpaid = players.find((_, i) => i % 2 === 1);
    expect(unpaid).toBeTruthy();

    const res = await mark(manager, tournament._id, {
      bookingId: unpaid.booking._id,
      sportId: sport._id,
      categoryName: MS,
      status: "checked_in",
    });
    expect(res.status).toBe(200);

    const list = await roster(manager, tournament._id);
    const row = list.body.data.find((r) => String(r.bookingId) === String(unpaid.booking._id));
    expect(row.attendanceStatus).toBe("checked_in");
    expect(row.paymentStatus).toBe("pending");
    expect(list.body.summary.unpaidPresent).toBe(1);
  });
});

describe("marking", () => {
  test("re-marking updates one row instead of accumulating history", async () => {
    const { manager, tournament, sport, players } = await seed({ registrations: 2 });
    const p = players[0];
    const body = { bookingId: p.booking._id, sportId: sport._id, categoryName: MS };

    await mark(manager, tournament._id, { ...body, status: "checked_in" });
    await mark(manager, tournament._id, { ...body, status: "no_show" });
    await mark(manager, tournament._id, { ...body, status: "checked_in" });

    expect(await TournamentAttendance.countDocuments({ bookingId: p.booking._id })).toBe(1);
    const row = await TournamentAttendance.findOne({ bookingId: p.booking._id }).lean();
    expect(row.status).toBe("checked_in");
  });

  test("rejects an entry that is not on the booking", async () => {
    const { manager, tournament, sport, players } = await seed({ registrations: 2 });
    const res = await mark(manager, tournament._id, {
      bookingId: players[0].booking._id,
      sportId: sport._id,
      categoryName: "A Category They Did Not Enter",
      status: "checked_in",
    });
    expect(res.status).toBe(404);
  });

  test("rejects an invalid status", async () => {
    const { manager, tournament, sport, players } = await seed({ registrations: 1 });
    const res = await mark(manager, tournament._id, {
      bookingId: players[0].booking._id,
      sportId: sport._id,
      categoryName: MS,
      status: "present-ish",
    });
    expect(res.status).toBe(400);
  });

  test("mark-remaining turns an unmarked roster into a decided one", async () => {
    const { manager, tournament, sport, players } = await seed({ registrations: 5 });

    // Two turn up.
    for (const p of players.slice(0, 2)) {
      await mark(manager, tournament._id, {
        bookingId: p.booking._id,
        sportId: sport._id,
        categoryName: MS,
        status: "checked_in",
      });
    }

    const res = await request(app)
      .post(`/api/tournaments/${tournament._id}/attendance/mark-remaining`)
      .set("Authorization", `Bearer ${mgrToken(manager._id)}`)
      .send({ sportId: sport._id, categoryName: MS });
    expect(res.status).toBe(200);
    expect(res.body.marked).toBe(3);

    const list = await roster(manager, tournament._id);
    expect(list.body.summary).toMatchObject({ total: 5, checkedIn: 2, noShow: 3, unmarked: 0 });
  });
});

describe("bulk marking", () => {
  test("marks a pasted list of names present and reports what it could not match", async () => {
    const { manager, tournament, sport } = await seed({ registrations: 5 });

    const res = await request(app)
      .post(`/api/tournaments/${tournament._id}/attendance/bulk`)
      .set("Authorization", `Bearer ${mgrToken(manager._id)}`)
      .send({
        sportId: sport._id,
        categoryName: MS,
        status: "checked_in",
        names: ["  player 1 ", "PLAYER 3", "Somebody Who Did Not Register"],
      });

    expect(res.status).toBe(200);
    expect(res.body.marked).toBe(2); // case/space-insensitive
    expect(res.body.unmatched).toHaveLength(1);
    expect(res.body.unmatched[0].reason).toBe("no_match");

    const list = await roster(manager, tournament._id);
    expect(list.body.summary.checkedIn).toBe(2);
  });
});

describe("player self check-in", () => {
  test("a player can check themselves in", async () => {
    const { tournament, players } = await seed({ registrations: 3 });
    const me = players[0];

    const res = await request(app)
      .post(`/api/tournaments/${tournament._id}/attendance/self`)
      .set("Authorization", `Bearer ${playerToken(me.user._id)}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.checkedIn).toHaveLength(1);

    const row = await TournamentAttendance.findOne({ bookingId: me.booking._id }).lean();
    expect(row.status).toBe("checked_in");
    expect(row.markedVia).toBe("player_mobile");
  });

  test("a player CANNOT check in someone else", async () => {
    const { tournament, players } = await seed({ registrations: 3 });
    const me = players[0];
    const someoneElse = players[1];

    // Even naming another booking, self check-in only ever touches the
    // caller's own registration.
    await request(app)
      .post(`/api/tournaments/${tournament._id}/attendance/self`)
      .set("Authorization", `Bearer ${playerToken(me.user._id)}`)
      .send({ bookingId: someoneElse.booking._id });

    expect(await TournamentAttendance.countDocuments({ bookingId: someoneElse.booking._id })).toBe(0);
    expect(await TournamentAttendance.countDocuments({ bookingId: me.booking._id })).toBe(1);
  });

  test("a player cannot mark themselves absent (that is a manager decision)", async () => {
    const { tournament, players } = await seed({ registrations: 2 });
    const me = players[0];

    await request(app)
      .post(`/api/tournaments/${tournament._id}/attendance/self`)
      .set("Authorization", `Bearer ${playerToken(me.user._id)}`)
      .send({ status: "no_show" });

    const row = await TournamentAttendance.findOne({ bookingId: me.booking._id }).lean();
    expect(row.status).toBe("checked_in"); // the requested status is ignored
  });

  test("an unregistered player is refused", async () => {
    const { tournament } = await seed({ registrations: 1 });
    const stranger = await User.create({
      name: "Stranger",
      email: `stranger-${Date.now()}@test.local`,
      password: "x",
      role: "Player",
      dateOfBirth: new Date("1995-01-01"),
      sex: "male",
      mobile: "9822222222",
    });

    const res = await request(app)
      .post(`/api/tournaments/${tournament._id}/attendance/self`)
      .set("Authorization", `Bearer ${playerToken(stranger._id)}`)
      .send({});
    expect(res.status).toBe(404);
  });

  test("anonymous self check-in is refused", async () => {
    const { tournament } = await seed({ registrations: 1 });
    const res = await request(app)
      .post(`/api/tournaments/${tournament._id}/attendance/self`)
      .send({});
    expect([401, 403]).toContain(res.status);
  });

  test("/attendance/me reports the player's own entry status", async () => {
    const { tournament, players } = await seed({ registrations: 2 });
    const me = players[0];

    const before = await request(app)
      .get(`/api/tournaments/${tournament._id}/attendance/me`)
      .set("Authorization", `Bearer ${playerToken(me.user._id)}`);
    expect(before.body.registered).toBe(true);
    expect(before.body.entries[0].attendanceStatus).toBe("registered");

    await request(app)
      .post(`/api/tournaments/${tournament._id}/attendance/self`)
      .set("Authorization", `Bearer ${playerToken(me.user._id)}`)
      .send({});

    const after = await request(app)
      .get(`/api/tournaments/${tournament._id}/attendance/me`)
      .set("Authorization", `Bearer ${playerToken(me.user._id)}`);
    expect(after.body.entries[0].attendanceStatus).toBe("checked_in");
  });
});

describe("walk-in registration", () => {
  test("registers and checks in an unregistered player in one action", async () => {
    const { manager, tournament, sport } = await seed({ registrations: 3 });

    const res = await request(app)
      .post(`/api/tournaments/${tournament._id}/attendance/walk-in`)
      .set("Authorization", `Bearer ${mgrToken(manager._id)}`)
      .send({ name: "Walk In Wanda", phone: "9833333333", sportId: sport._id, categoryName: MS });

    expect(res.status).toBe(201);
    expect(res.body.feeOwed).toBe(FEE); // owed, but not blocking

    const list = await roster(manager, tournament._id);
    expect(list.body.summary.total).toBe(4);
    const row = list.body.data.find((r) => r.userName === "Walk In Wanda");
    expect(row.attendanceStatus).toBe("checked_in");
    expect(row.isGuestBooking).toBe(true);
    expect(row.paymentStatus).toBe("pending");
  });

  test("the walk-in fee comes from the tournament, not the request", async () => {
    const { manager, tournament, sport } = await seed({ registrations: 1 });

    await request(app)
      .post(`/api/tournaments/${tournament._id}/attendance/walk-in`)
      .set("Authorization", `Bearer ${mgrToken(manager._id)}`)
      .send({ name: "Cheapskate", sportId: sport._id, categoryName: MS, fee: 1, totalFee: 1 });

    const booking = await Booking.findOne({ userName: "Cheapskate" }).lean();
    expect(booking.totalFee).toBe(FEE);
    expect(booking.sportSelections[0].fee).toBe(FEE);
  });

  test("marking a walk-in as paid records no outstanding fee", async () => {
    const { manager, tournament, sport } = await seed({ registrations: 1 });

    const res = await request(app)
      .post(`/api/tournaments/${tournament._id}/attendance/walk-in`)
      .set("Authorization", `Bearer ${mgrToken(manager._id)}`)
      .send({ name: "Paid Pat", sportId: sport._id, categoryName: MS, markPaid: true });

    expect(res.body.feeOwed).toBe(0);
    const booking = await Booking.findOne({ userName: "Paid Pat" }).lean();
    expect(booking.paymentStatus).toBe("paid");
  });

  test("rejects a category the tournament does not have", async () => {
    const { manager, tournament, sport } = await seed({ registrations: 1 });
    const res = await request(app)
      .post(`/api/tournaments/${tournament._id}/attendance/walk-in`)
      .set("Authorization", `Bearer ${mgrToken(manager._id)}`)
      .send({ name: "Nobody", sportId: sport._id, categoryName: "Nonexistent" });
    expect(res.status).toBe(400);
  });

  test("does not create a duplicate registration for an existing player", async () => {
    const { manager, tournament, sport, players } = await seed({ registrations: 2 });
    const existingName = players[0].user.name;

    await request(app)
      .post(`/api/tournaments/${tournament._id}/attendance/walk-in`)
      .set("Authorization", `Bearer ${mgrToken(manager._id)}`)
      .send({ name: existingName, sportId: sport._id, categoryName: MS });

    expect(await Booking.countDocuments({ tournamentId: tournament._id })).toBe(2);
    const list = await roster(manager, tournament._id);
    const row = list.body.data.find((r) => r.userName === existingName);
    expect(row.attendanceStatus).toBe("checked_in");
  });
});

describe("authorization", () => {
  test("a player cannot mark other people's attendance", async () => {
    const { tournament, sport, players } = await seed({ registrations: 2 });
    const res = await request(app)
      .post(`/api/tournaments/${tournament._id}/attendance/mark`)
      .set("Authorization", `Bearer ${playerToken(players[0].user._id)}`)
      .send({
        bookingId: players[1].booking._id,
        sportId: sport._id,
        categoryName: MS,
        status: "no_show",
      });
    expect([401, 403]).toContain(res.status);
    expect(await TournamentAttendance.countDocuments({})).toBe(0);
  });

  test("a player cannot register a walk-in", async () => {
    const { tournament, sport, players } = await seed({ registrations: 1 });
    const res = await request(app)
      .post(`/api/tournaments/${tournament._id}/attendance/walk-in`)
      .set("Authorization", `Bearer ${playerToken(players[0].user._id)}`)
      .send({ name: "Sneaky", sportId: sport._id, categoryName: MS });
    expect([401, 403]).toContain(res.status);
  });
});
