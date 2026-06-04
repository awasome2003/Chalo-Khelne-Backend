// tests/eligibility.test.js
// Run: npx jest tests/eligibility.test.js

const { eligibilityFor, parseTournamentDate, ageOn } = require("../utils/eligibility");

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeUser({ dob, sex } = {}) {
  return {
    dateOfBirth: dob ?? new Date("2005-06-15"),
    sex: sex ?? "male",
  };
}

function makeCategory({ minAge, maxAge, gender } = {}) {
  return {
    name: "Test Category",
    fee: 250,
    minAge: minAge ?? null,
    maxAge: maxAge ?? null,
    gender: gender ?? "any",
  };
}

const TOURNAMENT_DATE = "2019-02-20";

// ─── 1. Age boundary cases ───────────────────────────────────────────────────

describe("Age boundary — maxAge (upper cap)", () => {
  // maxAge 13 → player must be ≤ 13 on tournament date
  // tournament = 2019-02-20, so player must be born >= 2005-02-20

  test("born exactly on minBirthDate boundary → eligible", () => {
    const user = makeUser({ dob: new Date("2005-02-20") }); // exactly 14 — wait, maxAge=14
    const cat = makeCategory({ maxAge: 14 });
    const result = eligibilityFor(user, cat, TOURNAMENT_DATE);
    expect(result.eligible).toBe(true);
  });

  test("born one day after maxAge cutoff → ineligible", () => {
    // maxAge 13: player born 2005-02-19 turns 14 before tournament → over limit
    const user = makeUser({ dob: new Date("2005-02-19") });
    const cat = makeCategory({ maxAge: 13 });
    const result = eligibilityFor(user, cat, TOURNAMENT_DATE);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/maximum age is 13/i);
  });

  test("born exactly on maxAge cutoff date → eligible", () => {
    // maxAge 13: player born 2006-02-20 is exactly 13 on 2019-02-20
    const user = makeUser({ dob: new Date("2006-02-20") });
    const cat = makeCategory({ maxAge: 13 });
    const result = eligibilityFor(user, cat, TOURNAMENT_DATE);
    expect(result.eligible).toBe(true);
  });

  test("born one day before maxAge cutoff → eligible (just turned 13 day before)", () => {
    // born 2006-02-21 → turns 13 on 2019-02-21 → still 12 on tournament day
    const user = makeUser({ dob: new Date("2006-02-21") });
    const cat = makeCategory({ maxAge: 13 });
    const result = eligibilityFor(user, cat, TOURNAMENT_DATE);
    expect(result.eligible).toBe(true);
  });
});

describe("Age boundary — minAge (lower cap)", () => {
  test("player age exactly equals minAge → eligible", () => {
    // minAge 15: player born 2004-02-20 is exactly 15 on 2019-02-20
    const user = makeUser({ dob: new Date("2004-02-20") });
    const cat = makeCategory({ minAge: 15 });
    const result = eligibilityFor(user, cat, TOURNAMENT_DATE);
    expect(result.eligible).toBe(true);
  });

  test("player one year under minAge → ineligible", () => {
    // minAge 15: player born 2005-02-20 is 14 on tournament day
    const user = makeUser({ dob: new Date("2005-02-20") });
    const cat = makeCategory({ minAge: 15 });
    const result = eligibilityFor(user, cat, TOURNAMENT_DATE);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/minimum age is 15/i);
  });
});

// ─── 2. One-sided age limits ─────────────────────────────────────────────────

describe("One-sided age limits", () => {
  test("only maxAge set — young enough player → eligible", () => {
    const user = makeUser({ dob: new Date("2010-01-01") }); // age 9
    const cat = makeCategory({ maxAge: 12 });
    expect(eligibilityFor(user, cat, TOURNAMENT_DATE).eligible).toBe(true);
  });

  test("only maxAge set — too old player → ineligible", () => {
    const user = makeUser({ dob: new Date("2000-01-01") }); // age 19
    const cat = makeCategory({ maxAge: 12 });
    expect(eligibilityFor(user, cat, TOURNAMENT_DATE).eligible).toBe(false);
  });

  test("only minAge set — old enough player → eligible", () => {
    const user = makeUser({ dob: new Date("1980-01-01") }); // age 39
    const cat = makeCategory({ minAge: 39 });
    expect(eligibilityFor(user, cat, TOURNAMENT_DATE).eligible).toBe(true);
  });

  test("only minAge set — too young player → ineligible", () => {
    const user = makeUser({ dob: new Date("2000-01-01") }); // age 19
    const cat = makeCategory({ minAge: 39 });
    expect(eligibilityFor(user, cat, TOURNAMENT_DATE).eligible).toBe(false);
  });

  test("neither minAge nor maxAge set → always age-eligible", () => {
    const user = makeUser({ dob: new Date("1950-01-01") }); // age 69
    const cat = makeCategory({});
    expect(eligibilityFor(user, cat, TOURNAMENT_DATE).eligible).toBe(true);
  });
});

// ─── 3. Gender cases ─────────────────────────────────────────────────────────

describe("Gender restriction", () => {
  test("category male, player male → eligible", () => {
    const result = eligibilityFor(makeUser({ sex: "male" }), makeCategory({ gender: "male" }), TOURNAMENT_DATE);
    expect(result.eligible).toBe(true);
  });

  test("category male, player female → ineligible with gender reason", () => {
    const result = eligibilityFor(makeUser({ sex: "female" }), makeCategory({ gender: "male" }), TOURNAMENT_DATE);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/male players only/i);
  });

  test("category female, player male → ineligible with gender reason", () => {
    const result = eligibilityFor(makeUser({ sex: "male" }), makeCategory({ gender: "female" }), TOURNAMENT_DATE);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/female players only/i);
  });

  test("category any, player male → eligible", () => {
    const result = eligibilityFor(makeUser({ sex: "male" }), makeCategory({ gender: "any" }), TOURNAMENT_DATE);
    expect(result.eligible).toBe(true);
  });

  test("category any, player female → eligible", () => {
    const result = eligibilityFor(makeUser({ sex: "female" }), makeCategory({ gender: "any" }), TOURNAMENT_DATE);
    expect(result.eligible).toBe(true);
  });

  test("category male, player has no sex in profile → ineligible with profile reason", () => {
    const user = { dateOfBirth: new Date("2005-01-01"), sex: "" };
    const result = eligibilityFor(user, makeCategory({ gender: "male" }), TOURNAMENT_DATE);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/set gender/i);
  });

  test("category any, player has no sex → eligible (no gender restriction)", () => {
    const user = { dateOfBirth: new Date("2005-01-01"), sex: "" };
    const result = eligibilityFor(user, makeCategory({ gender: "any" }), TOURNAMENT_DATE);
    expect(result.eligible).toBe(true);
  });
});

// ─── 4. Tournament startDate parsing ─────────────────────────────────────────

describe("Tournament startDate parsing", () => {
  const user = makeUser({ dob: new Date("2005-01-01") });
  const cat = makeCategory({ maxAge: 15 });

  test("ISO format (2019-02-20) → works", () => {
    expect(() => eligibilityFor(user, cat, "2019-02-20")).not.toThrow();
  });

  test("DD/MM/YYYY format → works", () => {
    expect(() => eligibilityFor(user, cat, "20/02/2019")).not.toThrow();
  });

  test("DD-MM-YYYY format → works", () => {
    expect(() => eligibilityFor(user, cat, "20-02-2019")).not.toThrow();
  });

  test("native Date object → works", () => {
    expect(() => eligibilityFor(user, cat, new Date("2019-02-20"))).not.toThrow();
  });

  test("missing startDate (null) → throws TOURNAMENT_DATE_INVALID", () => {
    expect(() => eligibilityFor(user, cat, null)).toThrow(
      expect.objectContaining({ code: "TOURNAMENT_DATE_INVALID" })
    );
  });

  test("garbage string startDate → throws TOURNAMENT_DATE_INVALID", () => {
    expect(() => eligibilityFor(user, cat, "not-a-date")).toThrow(
      expect.objectContaining({ code: "TOURNAMENT_DATE_INVALID" })
    );
  });

  test("undefined startDate → throws TOURNAMENT_DATE_INVALID", () => {
    expect(() => eligibilityFor(user, cat, undefined)).toThrow(
      expect.objectContaining({ code: "TOURNAMENT_DATE_INVALID" })
    );
  });
});

// ─── 5. Player DOB edge cases ─────────────────────────────────────────────────

describe("Player DOB edge cases", () => {
  const cat = makeCategory({ maxAge: 15 });

  test("player DOB is null → ineligible with DOB reason", () => {
    const user = { dateOfBirth: null, sex: "male" };
    const result = eligibilityFor(user, cat, TOURNAMENT_DATE);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/date of birth/i);
  });

  test("player DOB is undefined → ineligible with DOB reason", () => {
    const user = { sex: "male" };
    const result = eligibilityFor(user, cat, TOURNAMENT_DATE);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/date of birth/i);
  });

  test("player DOB is invalid string → ineligible with invalid reason", () => {
    const user = { dateOfBirth: "not-a-date", sex: "male" };
    const result = eligibilityFor(user, cat, TOURNAMENT_DATE);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/invalid/i);
  });

  test("no age bounds + missing DOB → eligible (age not checked)", () => {
    // If category has no age restriction, DOB doesn't matter
    const user = { dateOfBirth: null, sex: "male" };
    const openCat = makeCategory({});
    const result = eligibilityFor(user, openCat, TOURNAMENT_DATE);
    expect(result.eligible).toBe(true);
  });
});

// ─── 6. Reason strings (mobile grey-out captions) ────────────────────────────

describe("Reason strings are short and player-facing", () => {
  test("age too high → reason mentions maximum age", () => {
    const user = makeUser({ dob: new Date("1990-01-01") }); // age 29
    const cat = makeCategory({ maxAge: 15 });
    const { reason } = eligibilityFor(user, cat, TOURNAMENT_DATE);
    expect(typeof reason).toBe("string");
    expect(reason.length).toBeLessThan(60);
    expect(reason).toMatch(/15/);
  });

  test("age too low → reason mentions minimum age", () => {
    const user = makeUser({ dob: new Date("2010-01-01") }); // age 9
    const cat = makeCategory({ minAge: 39 });
    const { reason } = eligibilityFor(user, cat, TOURNAMENT_DATE);
    expect(typeof reason).toBe("string");
    expect(reason.length).toBeLessThan(60);
    expect(reason).toMatch(/39/);
  });

  test("gender mismatch → reason is short and readable", () => {
    const user = makeUser({ sex: "female" });
    const cat = makeCategory({ gender: "male" });
    const { reason } = eligibilityFor(user, cat, TOURNAMENT_DATE);
    expect(typeof reason).toBe("string");
    expect(reason.length).toBeLessThan(60);
  });

  test("eligible result has no reason field", () => {
    const user = makeUser({ dob: new Date("2007-01-01") });
    const cat = makeCategory({ maxAge: 15 });
    const result = eligibilityFor(user, cat, TOURNAMENT_DATE);
    expect(result.eligible).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});

// ─── 7. Combined age + gender ─────────────────────────────────────────────────

describe("Combined age and gender", () => {
  test("correct age + correct gender → eligible", () => {
    const user = makeUser({ dob: new Date("2007-01-01"), sex: "male" });
    const cat = makeCategory({ maxAge: 15, gender: "male" });
    expect(eligibilityFor(user, cat, TOURNAMENT_DATE).eligible).toBe(true);
  });

  test("correct age + wrong gender → ineligible (gender checked first)", () => {
    const user = makeUser({ dob: new Date("2007-01-01"), sex: "female" });
    const cat = makeCategory({ maxAge: 15, gender: "male" });
    const result = eligibilityFor(user, cat, TOURNAMENT_DATE);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/male players only/i);
  });

  test("wrong age + correct gender → ineligible with age reason", () => {
    const user = makeUser({ dob: new Date("1990-01-01"), sex: "male" });
    const cat = makeCategory({ maxAge: 15, gender: "male" });
    const result = eligibilityFor(user, cat, TOURNAMENT_DATE);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/maximum age/i);
  });
});