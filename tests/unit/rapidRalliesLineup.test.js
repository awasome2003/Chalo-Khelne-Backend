/**
 * Unit tests for the Rapid Rallies S1 lineup constraint engine.
 * Pure logic — no DB. Run: npm run test:unit
 */
const RR = require("../../utils/rapidRalliesLineup");

// A valid 5-player roster (P3 female).
const roster = {
  P1: { name: "Aarav", gender: "male" },
  P2: { name: "Vivaan", gender: "male" },
  P3: { name: "Isha", gender: "female" },
  P4: { name: "Kabir", gender: "male" },
  P5: { name: "Rohan", gender: "male" },
};

describe("rubber-5 eligibility (not-played-singles)", () => {
  test("home excludes P1,P3", () => {
    expect(RR.rubber5Eligible("home").sort()).toEqual(["P2", "P4", "P5"]);
  });
  test("away excludes P2,P3", () => {
    expect(RR.rubber5Eligible("away").sort()).toEqual(["P1", "P4", "P5"]);
  });
});

describe("validateRoster", () => {
  test("valid roster passes", () => {
    expect(RR.validateRoster(roster).valid).toBe(true);
  });
  test("missing a player fails", () => {
    const r = { ...roster, P4: { name: "", gender: "male" } };
    expect(RR.validateRoster(r).valid).toBe(false);
  });
  test("P3 not female fails", () => {
    const r = { ...roster, P3: { name: "Isha", gender: "male" } };
    const res = RR.validateRoster(r);
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/P3 must be a female/i);
  });
  test("accepts 'F' shorthand for gender", () => {
    const r = { ...roster, P3: { name: "Isha", gender: "F" } };
    expect(RR.validateRoster(r).valid).toBe(true);
  });
  test("array roster shape works", () => {
    const arr = Object.entries(roster).map(([slot, v]) => ({ slot, ...v }));
    expect(RR.validateRoster(arr).valid).toBe(true);
  });
});

describe("validateSelection — home", () => {
  test("valid: P4 & P5 both covered by partners", () => {
    expect(RR.validateSelection("home", { partner2: "P4", partner4: "P5", singles5: "P2" }).valid).toBe(true);
  });
  test("valid: P5 covered by rubber-5 player", () => {
    expect(RR.validateSelection("home", { partner2: "P3", partner4: "P4", singles5: "P5" }).valid).toBe(true);
  });
  test("invalid: partner from outside pool (P1)", () => {
    const res = RR.validateSelection("home", { partner2: "P1", partner4: "P5", singles5: "P4" });
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/rubber-2 partner/i);
  });
  test("invalid: rubber-5 player already played singles (P1)", () => {
    const res = RR.validateSelection("home", { partner2: "P4", partner4: "P5", singles5: "P1" });
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/not played a singles/i);
  });
  test("invalid: participation — P4 and P5 never play", () => {
    const res = RR.validateSelection("home", { partner2: "P3", partner4: "P3", singles5: "P2" });
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/P4 never plays/);
    expect(res.errors.join(" ")).toMatch(/P5 never plays/);
  });
  test("invalid: participation — only P5 missing", () => {
    const res = RR.validateSelection("home", { partner2: "P4", partner4: "P3", singles5: "P2" });
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/P5 never plays/);
  });
  test("invalid: missing field", () => {
    expect(RR.validateSelection("home", { partner2: "P4", partner4: "P5" }).valid).toBe(false);
  });
});

describe("validateSelection — away (anchor swap)", () => {
  test("away rubber-5 P1 is valid", () => {
    expect(RR.validateSelection("away", { partner2: "P4", partner4: "P5", singles5: "P1" }).valid).toBe(true);
  });
  test("away rubber-5 P2 is invalid (played singles)", () => {
    expect(RR.validateSelection("away", { partner2: "P4", partner4: "P5", singles5: "P2" }).valid).toBe(false);
  });
});

describe("dynamic-mode feasibility", () => {
  test("isCompletable true when both P4/P5 still reachable", () => {
    expect(RR.isCompletable("home", { partner2: "P3" })).toBe(true);
  });
  test("isCompletable false when two partners burned on P3 leaving one field for two slots", () => {
    // partner2=P3, partner4=P3 → only singles5 left, can't cover BOTH P4 and P5
    expect(RR.isCompletable("home", { partner2: "P3", partner4: "P3" })).toBe(false);
  });
  test("validOptionsFor forces the last field to cover the missing slot", () => {
    // P4 covered by partner2, P5 not yet → singles5 must be P5
    expect(RR.validOptionsFor("home", "singles5", { partner2: "P4", partner4: "P3" })).toEqual(["P5"]);
  });
  test("validOptionsFor is unrestricted when participation already satisfied", () => {
    // both P4 & P5 covered by partners → any eligible rubber-5 player ok
    expect(RR.validOptionsFor("home", "singles5", { partner2: "P4", partner4: "P5" }).sort()).toEqual(["P2", "P4", "P5"]);
  });
  test("validOptionsFor partner2 from empty keeps all pool options", () => {
    expect(RR.validOptionsFor("home", "partner2", {}).sort()).toEqual(["P3", "P4", "P5"]);
  });
});

describe("resolveRubbers", () => {
  test("produces the 5-rubber slot map with anchors + picks", () => {
    const rubbers = RR.resolveRubbers(
      { partner2: "P4", partner4: "P5", singles5: "P2" },
      { partner2: "P4", partner4: "P5", singles5: "P1" }
    );
    expect(rubbers).toHaveLength(5);
    expect(rubbers[0]).toMatchObject({ setNumber: 1, homeSlots: ["P1"], awaySlots: ["P2"] });
    expect(rubbers[1]).toMatchObject({ setNumber: 2, homeSlots: ["P2", "P4"], awaySlots: ["P1", "P4"] });
    expect(rubbers[2]).toMatchObject({ setNumber: 3, homeSlots: ["P3"], awaySlots: ["P3"] });
    expect(rubbers[3]).toMatchObject({ setNumber: 4, homeSlots: ["P1", "P5"], awaySlots: ["P2", "P5"] });
    expect(rubbers[4]).toMatchObject({ setNumber: 5, homeSlots: ["P2"], awaySlots: ["P1"] });
  });
});

describe("validateTie", () => {
  test("valid full tie passes", () => {
    const res = RR.validateTie({
      homeRoster: roster,
      awayRoster: roster,
      homeSelection: { partner2: "P4", partner4: "P5", singles5: "P2" },
      awaySelection: { partner2: "P4", partner4: "P5", singles5: "P1" },
    });
    expect(res.valid).toBe(true);
  });
  test("surfaces side-prefixed errors", () => {
    const res = RR.validateTie({
      homeRoster: roster,
      awayRoster: roster,
      homeSelection: { partner2: "P3", partner4: "P3", singles5: "P2" },
      awaySelection: { partner2: "P4", partner4: "P5", singles5: "P1" },
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.startsWith("home:"))).toBe(true);
  });
});
