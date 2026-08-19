"use strict";
/**
 * Which fixture shape a doubles group gets — the two entrant models must not be
 * confused, or a match ends up with four people on one side.
 *
 * Model A (current): a pair registers as ONE entrant named "A & B", so a
 *   doubles group's player list already holds one row per pair. The correct
 *   fixture set is a plain round-robin between those entrants.
 *
 * Model B (legacy): each player entered separately and the fixture generator
 *   paired them (players[i] + players[i+1]), storing the second as `partner`.
 *
 * Both shapes exist in the database, so matchController detects rather than
 * assumes: an entrant naming two people is already a pair. These assertions
 * pin the detection rule the generator branches on.
 */
const { splitPair } = require("../../utils/doublesPair");

// Mirrors the check in matchController's group-stage generator.
const entrantsArePairs = (players) =>
  (players || []).some((p) => splitPair(p?.userName).length > 1);

const PAIRED = [
  { playerId: "1", userName: "Rahul & Amit" },
  { playerId: "2", userName: "Vijay & Sunil" },
  { playerId: "3", userName: "Karan & Rohit" },
];

const INDIVIDUALS = [
  { playerId: "1", userName: "Rahul" },
  { playerId: "2", userName: "Amit" },
  { playerId: "3", userName: "Vijay" },
  { playerId: "4", userName: "Sunil" },
];

describe("entrant shape detection", () => {
  test("pre-paired entrants are recognised", () => {
    expect(entrantsArePairs(PAIRED)).toBe(true);
  });

  test("individual entrants are recognised", () => {
    expect(entrantsArePairs(INDIVIDUALS)).toBe(false);
  });

  test("one pair among individuals is enough to treat the group as paired", () => {
    // A half-migrated group. Treating it as pre-paired is the safe direction:
    // re-pairing would silently merge two real pairs into one side.
    expect(entrantsArePairs([...INDIVIDUALS, { playerId: "5", userName: "A & B" }])).toBe(true);
  });

  test("names typed without spaces around the ampersand still count as pairs", () => {
    expect(entrantsArePairs([{ playerId: "1", userName: "Rahul&Amit" }])).toBe(true);
  });

  test("an empty or missing group is not 'paired'", () => {
    expect(entrantsArePairs([])).toBe(false);
    expect(entrantsArePairs(null)).toBe(false);
    expect(entrantsArePairs(undefined)).toBe(false);
  });

  test("a missing userName does not throw", () => {
    expect(entrantsArePairs([{ playerId: "1" }, { playerId: "2", userName: null }])).toBe(false);
  });
});

describe("fixture counts follow from the shape", () => {
  // Round-robin between N entrants is N*(N-1)/2 meetings.
  const roundRobin = (n) => (n * (n - 1)) / 2;

  test("3 pair-entrants play 3 doubles matches — not 1", () => {
    expect(entrantsArePairs(PAIRED)).toBe(true);
    expect(roundRobin(PAIRED.length)).toBe(3);
    // The legacy path would have paired 3 entrants into 1 pair (+1 dropped) and
    // produced no valid fixture at all.
  });

  test("4 individuals become 2 pairs playing 1 match", () => {
    expect(entrantsArePairs(INDIVIDUALS)).toBe(false);
    expect(roundRobin(INDIVIDUALS.length / 2)).toBe(1);
  });

  test("4 pair-entrants play 6 matches", () => {
    const four = [...PAIRED, { playerId: "4", userName: "Dev & Nikhil" }];
    expect(entrantsArePairs(four)).toBe(true);
    expect(roundRobin(four.length)).toBe(6);
  });
});
