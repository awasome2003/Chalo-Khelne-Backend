"use strict";
/**
 * CRITICAL FLOW 1 — Tournament creation.
 *
 * Drives POST /api/tournaments/createTournament through the real route stack:
 *   allowUserOrManager → requirePermission("tournament:create")
 *   → multer (no file) → scopeTournamentCreate → createTournament
 *
 * Asserts the happy path persists a Tournament, and that the two guard rails
 * the controller actually enforces (auth required; sports[] required) hold.
 */
const request = require("supertest");
const mongoose = require("mongoose");
const {
  startTestApp,
  stopTestApp,
  superAdminToken,
  clearDatabase,
} = require("./setup");

const Tournament = require("../../src/modules/tournaments/models/Tournament");
const Sport = require("../../src/modules/catalog/models/Sport");

let app;
let token;

beforeAll(async () => {
  app = await startTestApp();
});
afterAll(stopTestApp);

beforeEach(async () => {
  await clearDatabase();
  token = superAdminToken();
  // The Tournament model requires each embedded sport to carry a real
  // sportId (ref Sport); the controller resolves it from sportName. Seed the
  // sport so resolution is deterministic. (slug auto-generates from name.)
  await Sport.create({ name: "Carrom", category: "Board", scoringType: "board" });
});

const validBody = {
  title: "Integration Test Cup",
  sports: [
    {
      sportName: "Carrom",
      tournamentLevel: "unranked", // skip the SportRuleBook lookup branch
      categories: [{ name: "Open", fee: 0 }],
    },
  ],
};

test("creates a tournament and persists it", async () => {
  const res = await request(app)
    .post("/api/tournaments/createTournament")
    .set("Authorization", `Bearer ${token}`)
    .send(validBody);

  expect(res.status).toBeLessThan(400);

  const saved = await Tournament.findOne({ title: "Integration Test Cup" }).lean();
  expect(saved).toBeTruthy();
  expect(saved.sports).toHaveLength(1);
  expect(saved.sports[0].sportName).toBe("Carrom");
  expect(String(saved.sports[0].sportId)).toMatch(/^[a-f0-9]{24}$/);
});

test("rejects an unauthenticated request (401)", async () => {
  const res = await request(app)
    .post("/api/tournaments/createTournament")
    .send(validBody);

  expect(res.status).toBe(401);
});

test("rejects a payload with no sports[] (400)", async () => {
  const res = await request(app)
    .post("/api/tournaments/createTournament")
    .set("Authorization", `Bearer ${token}`)
    .send({ title: "No Sports Cup" });

  expect(res.status).toBe(400);
});

// ── Custom categories (no SuperAdmin template behind them) ──
//
// The wizard used to allow only SuperAdmin CategoryTemplate rows, so a manager
// could not run a category the template list did not contain. The server never
// enforced that list — it accepts any name — so a custom category has to
// round-trip cleanly, carrying its own age/gender bounds (which the booking
// eligibility gate reads) and its own format.
describe("custom categories", () => {
  const customBody = {
    title: "Custom Category Cup",
    sports: [{
      sportName: "Carrom",
      tournamentLevel: "unranked",
      type: "knockout + group stage",
      formatScope: "category",
      groupStageFormat: "Singles",
      knockoutFormat: "Singles",
      categories: [
        {
          // Deliberately NOT named "...Doubles": the format must come from the
          // explicit field, not from guessing at the name.
          templateId: null,
          name: "Corporate Pairs",
          fee: 500,
          minAge: 21,
          maxAge: 45,
          gender: "male",
          groupStageFormat: "Doubles",
          knockoutFormat: "Doubles",
          qualifyPerGroup: 2,
        },
      ],
    }],
  };

  test("persists a category with no templateId, keeping its bounds", async () => {
    const res = await request(app)
      .post("/api/tournaments/createTournament")
      .set("Authorization", `Bearer ${token}`)
      .send(customBody);
    expect(res.status).toBeLessThan(400);

    const saved = await Tournament.findOne({ title: "Custom Category Cup" }).lean();
    const cat = saved.sports[0].categories[0];
    expect(cat.templateId).toBeNull();
    expect(cat.name).toBe("Corporate Pairs");
    expect(cat.fee).toBe(500);
    // The eligibility gate rejects ineligible players from these values, so
    // they must survive exactly as entered.
    expect(cat.minAge).toBe(21);
    expect(cat.maxAge).toBe(45);
    expect(cat.gender).toBe("male");
  });

  test("a custom category resolves as doubles from its format, not its name", async () => {
    const res = await request(app)
      .post("/api/tournaments/createTournament")
      .set("Authorization", `Bearer ${token}`)
      .send(customBody);
    expect(res.status).toBeLessThan(400);

    const saved = await Tournament.findOne({ title: "Custom Category Cup" }).lean();
    const sportId = saved.sports[0].sportId;
    const { getGroupStageFormat, getKnockoutFormat } = require("../../utils/sportTrackUtils");

    // "Corporate Pairs" contains no "doubles", so the name-inference fallback
    // cannot help — the explicit per-category override is what makes this work.
    expect(getGroupStageFormat(saved, sportId, "Corporate Pairs")).toBe("Doubles");
    expect(getKnockoutFormat(saved, sportId, "Corporate Pairs")).toBe("Doubles");
  });

  test("a custom category with no bounds is open to everyone", async () => {
    const res = await request(app)
      .post("/api/tournaments/createTournament")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Open Custom Cup",
        sports: [{
          sportName: "Carrom",
          tournamentLevel: "unranked",
          categories: [{ templateId: null, name: "Anyone Welcome", fee: 0 }],
        }],
      });
    expect(res.status).toBeLessThan(400);

    const saved = await Tournament.findOne({ title: "Open Custom Cup" }).lean();
    const cat = saved.sports[0].categories[0];
    expect(cat.minAge).toBeNull();
    expect(cat.maxAge).toBeNull();
    expect(cat.gender).toBe("any");
  });

  test("template and custom categories coexist on one sport", async () => {
    const res = await request(app)
      .post("/api/tournaments/createTournament")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Mixed Source Cup",
        sports: [{
          sportName: "Carrom",
          tournamentLevel: "unranked",
          categories: [
            { name: "Under 19", fee: 100, minAge: null, maxAge: 19 },
            { templateId: null, name: "Corporate Pairs", fee: 500 },
          ],
        }],
      });
    expect(res.status).toBeLessThan(400);

    const saved = await Tournament.findOne({ title: "Mixed Source Cup" }).lean();
    expect(saved.sports[0].categories.map((c) => c.name)).toEqual([
      "Under 19",
      "Corporate Pairs",
    ]);
  });
});

// ── scoringType is the server's, not the client's ──
//
// §6.1 made the server the single source of the sport→scoringType mapping, but
// the create-tournament wizard kept its own hardcoded table, and the two had
// drifted: the web app said Carrom was "single" while the server said "board".
// The controller persisted the client's value verbatim, so every Carrom
// tournament created from that screen was stored with the wrong scoringType and
// opened the wrong scorer for the rest of its life.
describe("scoringType is derived server-side", () => {
  test("a wrong client scoringType is overridden — Carrom is board, not single", async () => {
    const res = await request(app)
      .post("/api/tournaments/createTournament")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Scoring Type Cup",
        sports: [{
          sportName: "Carrom",
          tournamentLevel: "unranked",
          categories: [{ name: "Open", fee: 0 }],
          // What the drifted client used to send.
          matchFormat: { scoringType: "single", totalSets: 3 },
        }],
      });
    expect(res.status).toBeLessThan(400);

    const saved = await Tournament.findOne({ title: "Scoring Type Cup" }).lean();
    expect(saved.sports[0].matchFormat.scoringType).toBe("board");
    // The rest of the client's match format is left alone.
    expect(saved.sports[0].matchFormat.totalSets).toBe(3);
  });

  test("a client that sends no scoringType still gets the server's", async () => {
    const res = await request(app)
      .post("/api/tournaments/createTournament")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "No Scoring Type Cup",
        sports: [{
          sportName: "Carrom",
          tournamentLevel: "unranked",
          categories: [{ name: "Open", fee: 0 }],
        }],
      });
    expect(res.status).toBeLessThan(400);

    const saved = await Tournament.findOne({ title: "No Scoring Type Cup" }).lean();
    expect(saved.sports[0].matchFormat.scoringType).toBe("board");
  });

  test("an unknown sport keeps the client value — the server has no mapping", async () => {
    // A custom sport created on the fly: getScoringType returns null, so the
    // client's value is the only information available.
    const res = await request(app)
      .post("/api/tournaments/createTournament")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Custom Sport Cup",
        sports: [{
          sportName: "Underwater Chess",
          tournamentLevel: "unranked",
          categories: [{ name: "Open", fee: 0 }],
          matchFormat: { scoringType: "single" },
        }],
      });
    expect(res.status).toBeLessThan(400);

    const saved = await Tournament.findOne({ title: "Custom Sport Cup" }).lean();
    expect(saved.sports[0].matchFormat.scoringType).toBe("single");
  });
});

// ── Per-category format (formatScope: "category") ──
//
// The manager declares format under each category instead of once per sport:
// Men's Doubles plays its group stage in singles and advances the top 3, while
// Women's Singles plays its group stage in doubles and advances the top 2.
// This asserts the whole round trip — wizard payload → controller → schema →
// resolvers — because each layer previously dropped these fields.
describe("per-category format round-trips through the API", () => {
  const perCategoryBody = {
    title: "Per Category Cup",
    sports: [
      {
        sportName: "Carrom",
        tournamentLevel: "unranked",
        formatScope: "category",
        type: "knockout + group stage",
        groupStageFormat: "Singles",
        knockoutFormat: "Singles",
        qualifyPerGroup: 2,
        categories: [
          {
            name: "Men's Doubles",
            fee: 400,
            groupStageFormat: "Singles",
            knockoutFormat: "Doubles",
            qualifyPerGroup: 3,
          },
          {
            name: "Women's Singles",
            fee: 400,
            type: "knockout",
            groupStageFormat: "Doubles",
            knockoutFormat: "Singles",
            qualifyPerGroup: 2,
            drawSize: 32,
          },
          // Declares nothing — must inherit the track.
          { name: "Under 19", fee: 400 },
        ],
      },
    ],
  };

  const create = () =>
    request(app)
      .post("/api/tournaments/createTournament")
      .set("Authorization", `Bearer ${token}`)
      .send(perCategoryBody);

  test("persists the per-category structural fields", async () => {
    expect((await create()).status).toBeLessThan(400);

    const saved = await Tournament.findOne({ title: "Per Category Cup" }).lean();
    const track = saved.sports[0];
    expect(track.formatScope).toBe("category");

    const byName = Object.fromEntries(track.categories.map((c) => [c.name, c]));

    expect(byName["Men's Doubles"]).toMatchObject({
      groupStageFormat: "Singles",
      knockoutFormat: "Doubles",
      qualifyPerGroup: 3,
    });
    expect(byName["Women's Singles"]).toMatchObject({
      type: "knockout",
      groupStageFormat: "Doubles",
      knockoutFormat: "Singles",
      qualifyPerGroup: 2,
      drawSize: 32,
    });
    // Null, not a copy of the track value — null is what makes the resolver
    // fall back, so a later edit of the sport still reaches this category.
    expect(byName["Under 19"].groupStageFormat).toBeNull();
    expect(byName["Under 19"].qualifyPerGroup).toBeNull();
  });

  test("the resolvers read back what the manager entered", async () => {
    expect((await create()).status).toBeLessThan(400);

    const saved = await Tournament.findOne({ title: "Per Category Cup" }).lean();
    const sportId = saved.sports[0].sportId;
    const {
      getGroupStageFormat,
      getKnockoutFormat,
      getQualifyPerGroup,
      getTournamentType,
    } = require("../../utils/sportTrackUtils");

    expect(getGroupStageFormat(saved, sportId, "Men's Doubles")).toBe("Singles");
    expect(getKnockoutFormat(saved, sportId, "Men's Doubles")).toBe("Doubles");
    expect(getQualifyPerGroup(saved, sportId, "Men's Doubles")).toBe(3);

    expect(getGroupStageFormat(saved, sportId, "Women's Singles")).toBe("Doubles");
    expect(getKnockoutFormat(saved, sportId, "Women's Singles")).toBe("Singles");
    expect(getQualifyPerGroup(saved, sportId, "Women's Singles")).toBe(2);
    expect(getTournamentType(saved, sportId, "Women's Singles")).toBe("knockout");

    // Inherits the track everywhere.
    expect(getGroupStageFormat(saved, sportId, "Under 19")).toBe("Singles");
    expect(getQualifyPerGroup(saved, sportId, "Under 19")).toBe(2);
    expect(getTournamentType(saved, sportId, "Under 19")).toBe("knockout + group stage");
  });

  test("a sport-level tournament is unaffected — no category overrides stored", async () => {
    const res = await request(app)
      .post("/api/tournaments/createTournament")
      .set("Authorization", `Bearer ${token}`)
      .send(validBody);
    expect(res.status).toBeLessThan(400);

    const saved = await Tournament.findOne({ title: "Integration Test Cup" }).lean();
    const track = saved.sports[0];
    expect(track.formatScope).toBe("sport");
    expect(track.categories[0].groupStageFormat).toBeNull();
    expect(track.categories[0].qualifyPerGroup).toBeNull();
  });

  test("an out-of-enum override is stored as null rather than failing the save", async () => {
    const res = await request(app)
      .post("/api/tournaments/createTournament")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Bad Enum Cup",
        sports: [{
          sportName: "Carrom",
          tournamentLevel: "unranked",
          categories: [{
            name: "Open",
            fee: 0,
            groupStageFormat: "",       // empty <select>
            knockoutFormat: "Nonsense", // not in the enum
            qualifyPerGroup: 0,         // a cutoff of 0 means nothing
            drawSize: 7,                // not an allowed draw size
          }],
        }],
      });
    expect(res.status).toBeLessThan(400);

    const saved = await Tournament.findOne({ title: "Bad Enum Cup" }).lean();
    const cat = saved.sports[0].categories[0];
    expect(cat.groupStageFormat).toBeNull();
    expect(cat.knockoutFormat).toBeNull();
    expect(cat.qualifyPerGroup).toBeNull();
    expect(cat.drawSize).toBeNull();
  });
});
