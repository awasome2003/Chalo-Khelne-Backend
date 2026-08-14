"use strict";
/**
 * setsToWin resolution.
 *
 * Best-of-N means first to ceil(N/2) — 2 of 3, 3 of 5, 4 of 7. Never all N.
 *
 * Every match model declares matchFormat.setsToWin with a DEFAULT OF 3, paired
 * with maxSets: 5. A match created without an explicit format therefore claims
 * "win 3 sets". On a best-of-3 that demands all three, so a legitimate 2-0 was
 * rejected as "not enough sets to determine winner". Worse, the recompute
 * guard in the group-stage bulk upload read
 * `if (!match.matchFormat.setsToWin)` — always false thanks to that default —
 * so the correct recomputation was unreachable.
 */
const { resolveSetsToWin, readMatchFormat } = require("../../utils/matchFormatUtils");

describe("resolveSetsToWin", () => {
  test("best-of-N needs ceil(N/2), not N", () => {
    expect(resolveSetsToWin({ totalSets: 3 })).toBe(2);
    expect(resolveSetsToWin({ totalSets: 5 })).toBe(3);
    expect(resolveSetsToWin({ totalSets: 7 })).toBe(4);
    expect(resolveSetsToWin({ totalSets: 1 })).toBe(1);
  });

  test("clamps the stale default — the reported bug", () => {
    // A best-of-3 match carrying the schema default setsToWin: 3.
    expect(resolveSetsToWin({ totalSets: 3, setsToWin: 3 })).toBe(2);
    // Same via the maxSets container, for docs predating totalSets.
    expect(resolveSetsToWin({ maxSets: 3, setsToWin: 3 })).toBe(2);
  });

  test("leaves a consistent stored value alone", () => {
    expect(resolveSetsToWin({ totalSets: 5, setsToWin: 3 })).toBe(3);
    expect(resolveSetsToWin({ totalSets: 7, setsToWin: 4 })).toBe(4);
    // A deliberately shorter requirement is honoured, not inflated.
    expect(resolveSetsToWin({ totalSets: 5, setsToWin: 2 })).toBe(2);
  });

  test("prefers totalSets over maxSets when both are present", () => {
    expect(resolveSetsToWin({ totalSets: 3, maxSets: 5, setsToWin: 3 })).toBe(2);
  });

  test("falls back to maxSets when totalSets is absent", () => {
    expect(resolveSetsToWin({ maxSets: 5 })).toBe(3);
  });

  test("handles missing, empty and malformed input", () => {
    expect(resolveSetsToWin(null)).toBe(1);
    expect(resolveSetsToWin({})).toBe(1);
    expect(resolveSetsToWin({ setsToWin: 2 })).toBe(2); // no container to clamp against
    expect(resolveSetsToWin({ totalSets: 0, setsToWin: 0 })).toBe(1);
    expect(resolveSetsToWin({ totalSets: "3", setsToWin: "3" })).toBe(2); // numeric strings
  });
});

describe("readMatchFormat applies the same clamp", () => {
  test("a best-of-3 carrying setsToWin: 3 reads back as 2", () => {
    const fmt = readMatchFormat({
      _id: "m1",
      matchFormat: { scoringType: "sets", totalSets: 3, setsToWin: 3, maxSets: 3 },
    });
    expect(fmt.setsToWin).toBe(2);
    expect(fmt.totalSets).toBe(3);
  });

  test("a genuine best-of-5 is untouched", () => {
    const fmt = readMatchFormat({
      _id: "m2",
      matchFormat: { scoringType: "sets", totalSets: 5, setsToWin: 3 },
    });
    expect(fmt.setsToWin).toBe(3);
  });

  test("setsToWin can never exceed ceil(totalSets/2) after a read", () => {
    // Only odd containers — validateMatchFormat rejects an even totalSets,
    // since best-of-N is always odd.
    for (const totalSets of [1, 3, 5, 7]) {
      const fmt = readMatchFormat({
        _id: "m",
        matchFormat: { scoringType: "sets", totalSets, setsToWin: 99 },
      });
      expect(fmt.setsToWin).toBeLessThanOrEqual(Math.ceil(totalSets / 2));
      expect(fmt.setsToWin).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("the scenario from the report", () => {
  test("2-0 decides a best-of-3", () => {
    const setsToWin = resolveSetsToWin({ totalSets: 3, setsToWin: 3 });
    const p1Wins = 2;
    const p2Wins = 0;
    // The guard that produced "Need 3 sets to win".
    const rejected = p1Wins < setsToWin && p2Wins < setsToWin;
    expect(rejected).toBe(false);
    expect(p1Wins).toBeGreaterThanOrEqual(setsToWin);
  });

  test("1-0 still does NOT decide a best-of-3", () => {
    const setsToWin = resolveSetsToWin({ totalSets: 3, setsToWin: 3 });
    expect(1 < setsToWin && 0 < setsToWin).toBe(true);
  });
});
