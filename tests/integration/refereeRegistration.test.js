"use strict";
/**
 * A referee can enter a tournament as a competitor.
 *
 * The booking endpoint is gated by requirePermission("tournament:register").
 * The referee role never carried that permission, so a referee's registration
 * was rejected with a bare 403 "Access denied" — indistinguishable from an
 * expired login. Trainer, the other non-Player participant role, always had
 * it; officiating one tournament should not stop someone entering another.
 *
 * Roles here are built from scripts/seedRbac's own DEFAULT_ROLES, so if that
 * definition loses the permission again this test fails rather than silently
 * drifting from what the seed actually provisions.
 */
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { startTxApp, stopTxApp, clearDatabase } = require("./setupReplset");

const Tournament = require("../../src/modules/tournaments/models/Tournament");
const Sport = require("../../src/modules/catalog/models/Sport");
const Booking = require("../../src/modules/tournaments/models/BookingModel");
const User = require("../../src/modules/identity/models/User");
const Role = require("../../src/modules/identity/models/Role");
const Permission = require("../../src/modules/identity/models/Permission");
const { DEFAULT_ROLES } = require("../../scripts/seedRbac");

let app;

beforeAll(async () => { app = await startTxApp(); });
afterAll(stopTxApp);
beforeEach(clearDatabase);

/** Provision one role exactly as seedRbac would, from the same definition. */
async function seedRoleFromDefinition(slug) {
  const def = DEFAULT_ROLES.find((r) => r.slug === slug);
  if (!def) throw new Error(`No seed definition for role "${slug}"`);

  const ids = [];
  for (const key of def.permissionKeys) {
    const existing = await Permission.findOne({ key });
    if (existing) { ids.push(existing._id); continue; }
    const [module_, action] = key.split(":");
    const created = await Permission.create({ key, name: key, module: module_, action });
    ids.push(created._id);
  }

  await Role.create({
    name: def.name,
    slug: def.slug,
    authorityLevel: def.authorityLevel,
    permissions: ids,
  });
  return def;
}

let uniq = 0;
async function makeUser(role) {
  uniq += 1;
  return User.create({
    name: `${role} Person ${uniq}`,
    email: `ref-${uniq}-${Date.now()}@test.local`,
    password: "hashed-not-used",
    role,
    dateOfBirth: new Date("1995-01-01"),
    sex: "male",
    mobile: "9999999999",
  });
}

const tokenFor = (user) =>
  jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });

async function seedTournament() {
  const sport = await Sport.create({ name: "Carrom", category: "Board", scoringType: "board" });
  const tournament = await Tournament.create({
    title: "Referee Entry Cup",
    startDate: new Date("2030-01-01"),
    endDate: new Date("2030-01-05"),
    sports: [{
      sportId: sport._id,
      sportName: "Carrom",
      tournamentLevel: "unranked",
      categories: [{ name: "Open", fee: 0 }],
    }],
  });
  return { sport, tournament };
}

const book = (user, tournament, sport) =>
  request(app)
    .post("/api/tournaments/bookings/create")
    .set("Authorization", `Bearer ${tokenFor(user)}`)
    .send({
      userId: String(user._id),
      userName: user.name,
      tournamentId: String(tournament._id),
      tournamentName: tournament.title,
      tournamentType: "Knockout",
      paymentMethod: "cash",
      sportSelections: [{
        sportId: String(sport._id),
        sportName: "Carrom",
        categoryName: "Open",
      }],
    });

describe("referee self-registration", () => {
  test("the seed grants the referee role tournament:register", () => {
    const referee = DEFAULT_ROLES.find((r) => r.slug === "referee");
    expect(referee.permissionKeys).toContain("tournament:register");
  });

  test("a referee can create a booking", async () => {
    await seedRoleFromDefinition("referee");
    const { sport, tournament } = await seedTournament();
    const referee = await makeUser("Referee");

    const res = await book(referee, tournament, sport);

    expect(res.status).toBeLessThan(400);
    const booking = await Booking.findOne({ userId: referee._id }).lean();
    expect(booking).toBeTruthy();
  });

  test("a player can still create a booking", async () => {
    // The referee grant must not have disturbed the role that always worked.
    await seedRoleFromDefinition("player");
    const { sport, tournament } = await seedTournament();
    const player = await makeUser("Player");

    const res = await book(player, tournament, sport);
    expect(res.status).toBeLessThan(400);
  });

  test("a referee still cannot do a manager-only action", async () => {
    // Registration is now allowed; tournament:create is not. Widening one
    // permission must not read as widening the role.
    await seedRoleFromDefinition("referee");
    const referee = await makeUser("Referee");

    const res = await request(app)
      .post("/api/tournaments/createTournament")
      .set("Authorization", `Bearer ${tokenFor(referee)}`)
      .send({ title: "Should Not Work", sports: [] });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await Tournament.countDocuments({ title: "Should Not Work" })).toBe(0);
  });
});
