"use strict";
/**
 * §6.1 regression — the three scoring tables must not drift again.
 *
 * The sport→scoringType mapping and its display labels existed three times,
 * once per codebase, as hardcoded object literals — and the three copies had
 * diverged:
 *
 *   Sport          Server   Web app          Mobile app
 *   Carrom         board    single           board
 *   Foosball       sets     absent → null    absent → null
 *   Snooker        —        single           single
 *   Turf Games     —        single           single
 *   Cricket Nets   —        single           single
 *
 * The web app's LABELS had no `board` entry at all, so a Carrom match the
 * server recorded board-by-board was collapsed to one value under "Game /
 * Result" headings while mobile rendered it correctly — two clients, one match,
 * two different scores on screen, for a live client sport.
 *
 * The server is now the single source (GET /api/sports/scoring-config) and each
 * client keeps only a SEED copy for first paint. This test reads both clients'
 * seeds off disk and asserts they match the server's table, so a hand-edit to
 * one of them fails here instead of shipping.
 *
 * §8.3: this is one of the two assertions the defect register said would have
 * caught two of its own Criticals.
 */

const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { startTxApp, stopTxApp, clearDatabase } = require("./setupReplset");

const {
  SPORT_SCORING_TYPES,
  SCORING_LABELS,
  DEFAULT_SCORING_TYPE,
  getScoringType,
} = require("../../utils/matchFormatUtils");

const OLD_VERSION = path.join(__dirname, "..", "..", "..");
const WEB_SEED = path.join(
  OLD_VERSION, "sports_app", "src", "shared", "utils", "scoringConfig.js"
);
const MOBILE_SEED = path.join(
  OLD_VERSION, "client", "src", "utils", "scoringConfig.ts"
);

let app;
beforeAll(async () => {
  app = await startTxApp();
});
afterAll(stopTxApp);
beforeEach(clearDatabase);

/**
 * Pull the SEED_CONFIG literal out of a client file without executing it.
 * Deliberately source-level: the point is to catch a hand-edit to the seed.
 */
function readSeed(file) {
  const src = fs.readFileSync(file, "utf8");

  const sportsBlock = /sports:\s*\{([\s\S]*?)\n {2}\},/.exec(src);
  const labelsBlock = /labels:\s*\{([\s\S]*?)\n {2}\},/.exec(src);
  expect(sportsBlock).toBeTruthy();
  expect(labelsBlock).toBeTruthy();

  const sports = {};
  for (const m of sportsBlock[1].matchAll(/["']?([A-Za-z ]+)["']?:\s*"(\w+)"/g)) {
    sports[m[1].trim()] = m[2];
  }

  const labels = {};
  for (const m of labelsBlock[1].matchAll(/(\w+):\s*\{([^}]*)\}/g)) {
    labels[m[1]] = m[2];
  }

  return { sports, labels, raw: src };
}

describe("client seeds match the server table (§6.1)", () => {
  const clients = [
    ["web", WEB_SEED],
    ["mobile", MOBILE_SEED],
  ];

  it.each(clients)("%s seed file exists", (_name, file) => {
    expect(fs.existsSync(file)).toBe(true);
  });

  it.each(clients)("%s sport map agrees with the server", (_name, file) => {
    const { sports } = readSeed(file);
    for (const [sport, type] of Object.entries(SPORT_SCORING_TYPES)) {
      expect(sports[sport]).toBe(type);
    }
  });

  it.each(clients)("%s declares no sport the server does not know", (_name, file) => {
    const { sports } = readSeed(file);
    for (const sport of Object.keys(sports)) {
      expect(SPORT_SCORING_TYPES[sport]).toBeDefined();
    }
  });

  it.each(clients)("%s has a label entry for every scoring type", (_name, file) => {
    const { labels } = readSeed(file);
    for (const type of Object.keys(SCORING_LABELS)) {
      // `board` is the one the web app was missing entirely.
      expect(labels[type]).toBeDefined();
    }
  });

  it.each(clients)("%s no longer falls back to LABELS.sets", (_name, file) => {
    const { raw } = readSeed(file);
    // Strip comments first — these files DESCRIBE the old `|| LABELS.sets`
    // fallback in their docblocks, and the point of the assertion is that no
    // executable code still does it.
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/\|\|\s*LABELS\.sets/);
    expect(code).toMatch(/defaultScoringType:\s*"single"/);
  });
});

describe("the client tables are gone (§6.1)", () => {
  const utils = [
    path.join(OLD_VERSION, "sports_app", "src", "shared", "utils", "matchResultUtils.js"),
    path.join(OLD_VERSION, "client", "src", "utils", "matchResultUtils.ts"),
  ];

  it.each(utils)("%s no longer hardcodes SPORT_SCORING_TYPES", (file) => {
    const src = fs.readFileSync(file, "utf8");
    expect(src).not.toMatch(/const SPORT_SCORING_TYPES/);
  });

  it.each(utils)("%s no longer hardcodes a LABELS table", (file) => {
    const src = fs.readFileSync(file, "utf8");
    expect(src).not.toMatch(/^const LABELS/m);
  });
});

describe("GET /api/sports/scoring-config", () => {
  it("serves the sport map, labels and default", async () => {
    const res = await request(app).get("/api/sports/scoring-config");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { sports, labels, defaultScoringType } = res.body.data;
    expect(sports.Carrom).toBe("board");
    expect(sports.Foosball).toBe("sets");
    expect(labels.board).toBeDefined();
    expect(labels.board.round).toBe("Board");
    expect(defaultScoringType).toBe("single");
  });

  it("is reachable without authentication", async () => {
    const res = await request(app).get("/api/sports/scoring-config");
    expect(res.status).toBe(200);
  });
});

describe("server scoring resolution", () => {
  it("resolves Carrom as board, not single", () => {
    // The specific disagreement that put two different scores on two screens.
    expect(getScoringType("Carrom")).toBe("board");
  });

  it("resolves Foosball, which neither client used to know", () => {
    expect(getScoringType("Foosball")).toBe("sets");
  });

  it("is case-insensitive", () => {
    expect(getScoringType("carrom")).toBe("board");
    expect(getScoringType("TABLE TENNIS")).toBe("sets");
  });

  it("returns null for an unknown sport rather than guessing", () => {
    expect(getScoringType("Underwater Hockey")).toBeNull();
  });

  it("has a label set for every scoring type it can return", () => {
    for (const type of Object.values(SPORT_SCORING_TYPES)) {
      expect(SCORING_LABELS[type]).toBeDefined();
    }
    expect(SCORING_LABELS[DEFAULT_SCORING_TYPE]).toBeDefined();
  });
});
