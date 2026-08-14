"use strict";
/**
 * Direct Knockout — the "Confirm bracket generation" modal.
 *
 * The modal collects three scheduling inputs (court count, match duration, gap
 * between matches on the same court) and posts them alongside a per-round
 * schedule. These tests send the EXACT payload MDirectKnockout.doGenerate
 * builds and assert the generated match documents reflect it: courts fan out,
 * slot stride equals duration+gap, matchEndTime honours the duration, and each
 * round starts after the previous one finishes plus the break.
 *
 * Times are asserted as deltas, never absolute wall-clock, so the suite is
 * timezone-independent.
 */
const request = require("supertest");
const {
  startTestApp, stopTestApp, superAdminToken, clearDatabase,
} = require("./setup");

const Tournament = require("../../src/modules/tournaments/models/Tournament");
const Sport = require("../../src/modules/catalog/models/Sport");
const DirectKnockoutMatch = require("../../src/modules/tournaments/models/DirectKnockoutMatch");

let app;
let token;

beforeAll(async () => { app = await startTestApp(); });
afterAll(stopTestApp);
beforeEach(async () => { await clearDatabase(); token = superAdminToken(); });

const EIGHT = ["A", "B", "C", "D", "E", "F", "G", "H"].map((n) => ({ userName: n }));
const MIN = 60 * 1000;

async function seedBadminton() {
  const sport = await Sport.create({ name: "Badminton", category: "Racquet", scoringType: "sets" });
  const t = await Tournament.create({
    title: "Modal Cup",
    sports: [{
      sportId: sport._id, sportName: "Badminton", tournamentLevel: "unranked",
      categories: [{ name: "Open", fee: 0 }],
      matchFormat: { scoringType: "sets", totalSets: 3, setsToWin: 2, pointsPerSet: 21 },
    }],
  });
  return { tournamentId: String(t._id), sportId: String(sport._id) };
}

// Mirrors buildDefaultRoundsArray + buildRequestRounds in
// sports_app/src/Manager/utils/knockoutDefaults.js — the modal keeps the
// cascading bestOf defaults and overrides only the durations.
function buildRounds(totalRounds, matchDuration, gap) {
  const out = [];
  for (let rn = 1; rn <= totalRounds; rn++) {
    const fromEnd = totalRounds - rn;
    const bestOf = fromEnd === 0 ? 7 : fromEnd === 1 ? 5 : 3;
    out.push({
      roundNumber: rn,
      bestOf,
      slotDurationMinutes: matchDuration + gap,
      matchDurationMinutes: matchDuration,
    });
  }
  return out;
}

/** The exact request body doGenerate posts. */
function modalPayload({ tournamentId, sportId, courtCount, matchDuration, gap, drawSize = 8 }) {
  const totalRounds = Math.ceil(Math.log2(drawSize));
  return {
    tournamentId,
    sportId,
    category: "Open",
    players: EIGHT,
    drawSize,
    drawMethod: "standard",
    numberOfSeeds: EIGHT.length,
    courtCount,
    matchDurationMinutes: matchDuration,
    gapMinutes: gap,
    schedule: {
      startDate: "2026-09-01",
      startTime: "09:00",
      rounds: buildRounds(totalRounds, matchDuration, gap),
      breakBetweenRoundsMinutes: gap || 5,
      courtNumber: "1",
    },
    confirm: true,
  };
}

const generate = (body) =>
  request(app)
    .post("/api/tournaments/direct-knockout/standalone/create")
    .set("Authorization", `Bearer ${token}`)
    .send(body);

async function loadRound(tournamentId, roundNumber) {
  return DirectKnockoutMatch.find({ tournamentId, roundNumber })
    .sort({ matchNumber: 1 })
    .lean();
}

describe("court count field", () => {
  test("3 courts fan out across round 1 and wrap onto court 1", async () => {
    const { tournamentId, sportId } = await seedBadminton();
    const res = await generate(modalPayload({
      tournamentId, sportId, courtCount: 3, matchDuration: 25, gap: 5,
    }));
    expect(res.status).toBe(201);

    const r1 = await loadRound(tournamentId, 1);
    expect(r1).toHaveLength(4);
    // 4 matches over 3 courts → 1,2,3 then wrap to 1.
    expect(r1.map((m) => m.courtNumber)).toEqual(["1", "2", "3", "1"]);
  });

  test("1 court puts every match on court 1, staggered in time", async () => {
    const { tournamentId, sportId } = await seedBadminton();
    await generate(modalPayload({
      tournamentId, sportId, courtCount: 1, matchDuration: 25, gap: 5,
    }));

    const r1 = await loadRound(tournamentId, 1);
    expect(new Set(r1.map((m) => m.courtNumber))).toEqual(new Set(["1"]));
    // Same court ⇒ each match starts one slot (25+5) after the previous.
    const starts = r1.map((m) => new Date(m.matchStartTime).getTime());
    expect((starts[1] - starts[0]) / MIN).toBe(30);
    expect((starts[3] - starts[0]) / MIN).toBe(90);
  });

  test("more courts than matches leaves the surplus unused", async () => {
    const { tournamentId, sportId } = await seedBadminton();
    await generate(modalPayload({
      tournamentId, sportId, courtCount: 10, matchDuration: 25, gap: 5,
    }));

    const r1 = await loadRound(tournamentId, 1);
    expect(r1.map((m) => m.courtNumber)).toEqual(["1", "2", "3", "4"]);
    // All four run in parallel — identical start times.
    const starts = new Set(r1.map((m) => new Date(m.matchStartTime).getTime()));
    expect(starts.size).toBe(1);
  });
});

describe("duration and gap fields", () => {
  test("matchEndTime honours the match duration, not the slot", async () => {
    const { tournamentId, sportId } = await seedBadminton();
    await generate(modalPayload({
      tournamentId, sportId, courtCount: 2, matchDuration: 25, gap: 5,
    }));

    const r1 = await loadRound(tournamentId, 1);
    for (const m of r1) {
      const mins = (new Date(m.matchEndTime) - new Date(m.matchStartTime)) / MIN;
      expect(mins).toBe(25); // the 5-minute gap is stride, not playing time
    }
  });

  test("changing the gap changes the stride on a court", async () => {
    const { tournamentId, sportId } = await seedBadminton();
    await generate(modalPayload({
      tournamentId, sportId, courtCount: 1, matchDuration: 20, gap: 15,
    }));

    const r1 = await loadRound(tournamentId, 1);
    const starts = r1.map((m) => new Date(m.matchStartTime).getTime());
    expect((starts[1] - starts[0]) / MIN).toBe(35); // 20 + 15
  });

  test("a zero gap yields back-to-back matches", async () => {
    const { tournamentId, sportId } = await seedBadminton();
    await generate(modalPayload({
      tournamentId, sportId, courtCount: 1, matchDuration: 30, gap: 0,
    }));

    const r1 = await loadRound(tournamentId, 1);
    const starts = r1.map((m) => new Date(m.matchStartTime).getTime());
    expect((starts[1] - starts[0]) / MIN).toBe(30);
    const first = r1[0];
    // End of match 1 == start of match 2.
    expect(new Date(first.matchEndTime).getTime()).toBe(starts[1]);
  });
});

describe("round sequencing", () => {
  test("each round starts after the previous round's slots plus the break", async () => {
    const { tournamentId, sportId } = await seedBadminton();
    await generate(modalPayload({
      tournamentId, sportId, courtCount: 3, matchDuration: 25, gap: 5,
    }));

    const [r1, r2, r3] = await Promise.all([
      loadRound(tournamentId, 1), loadRound(tournamentId, 2), loadRound(tournamentId, 3),
    ]);
    const start = (r) => new Date(r[0].matchStartTime).getTime();

    // R1: 4 matches / 3 courts = 2 slot rows × 30 min, then a 5 min break.
    expect((start(r2) - start(r1)) / MIN).toBe(65);
    // R2: 2 matches / 3 courts = 1 slot row × 30 min, then 5 min.
    expect((start(r3) - start(r2)) / MIN).toBe(35);
    // No round starts before the one feeding it has finished.
    expect(start(r2)).toBeGreaterThan(new Date(r1[0].matchEndTime).getTime());
    expect(start(r3)).toBeGreaterThan(new Date(r2[0].matchEndTime).getTime());
  });

  test("the per-round bestOf cascade survives the modal's duration override", async () => {
    const { tournamentId, sportId } = await seedBadminton();
    await generate(modalPayload({
      tournamentId, sportId, courtCount: 2, matchDuration: 25, gap: 5,
    }));

    const r1 = await loadRound(tournamentId, 1);
    const final = await DirectKnockoutMatch.findOne({ tournamentId, round: "final" }).lean();
    // The modal overrides only durations — Bo3 early, Bo7 final still applies.
    expect(r1[0].matchFormat.setsToWin).toBe(2);
    expect(final.matchFormat.setsToWin).toBe(4);
  });
});

describe("field edge cases", () => {
  test("a cleared court-count box falls back to a single court", async () => {
    const { tournamentId, sportId } = await seedBadminton();
    // The input's onChange coerces an empty box to 0 via `Number(v) || 0`.
    const res = await generate(modalPayload({
      tournamentId, sportId, courtCount: 0, matchDuration: 25, gap: 5,
    }));
    expect(res.status).toBe(201);

    const r1 = await loadRound(tournamentId, 1);
    // No pool ⇒ legacy single-court mode, using schedule.courtNumber.
    expect(new Set(r1.map((m) => m.courtNumber))).toEqual(new Set(["1"]));
  });

  test("a cleared duration box falls back to per-round defaults, never zero-length", async () => {
    const { tournamentId, sportId } = await seedBadminton();
    const res = await generate(modalPayload({
      tournamentId, sportId, courtCount: 2, matchDuration: 0, gap: 0,
    }));
    expect(res.status).toBe(201);

    const r1 = await loadRound(tournamentId, 1);
    for (const m of r1) {
      const mins = (new Date(m.matchEndTime) - new Date(m.matchStartTime)) / MIN;
      expect(mins).toBeGreaterThan(0);
    }
  });

  test("every generated match carries a court and a start time", async () => {
    const { tournamentId, sportId } = await seedBadminton();
    await generate(modalPayload({
      tournamentId, sportId, courtCount: 3, matchDuration: 25, gap: 5,
    }));

    const all = await DirectKnockoutMatch.find({ tournamentId }).lean();
    expect(all).toHaveLength(7);
    for (const m of all) {
      expect(m.courtNumber).toBeTruthy();
      expect(m.matchStartTime).toBeTruthy();
      expect(m.matchEndTime).toBeTruthy();
      expect(new Date(m.matchEndTime).getTime())
        .toBeGreaterThan(new Date(m.matchStartTime).getTime());
    }
  });
});
