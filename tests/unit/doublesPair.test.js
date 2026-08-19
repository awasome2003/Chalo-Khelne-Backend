"use strict";
/**
 * Doubles pair naming — a pair is ONE entrant named "A & B".
 *
 * The order-insensitive key is the important part: the same pair can be typed
 * either way round (mobile registration, bulk Excel upload, a manager adding a
 * late entry), and without sorting the halves "Rahul & Amit" and "Amit & Rahul"
 * become two entrants and the pair enters the draw twice.
 */
const {
  pairKey,
  pairDisplayName,
  splitPair,
  isSamePair,
  namesInEntry,
  normalizeName,
} = require("../../utils/doublesPair");

describe("pairDisplayName", () => {
  test("joins two players into one entrant name", () => {
    expect(pairDisplayName("Rahul", "Amit")).toBe("Rahul & Amit");
  });

  test("trims each half", () => {
    expect(pairDisplayName("  Rahul ", " Amit  ")).toBe("Rahul & Amit");
  });

  test("a missing partner leaves the name unchanged — safe for singles", () => {
    expect(pairDisplayName("Rahul", null)).toBe("Rahul");
    expect(pairDisplayName("Rahul", "")).toBe("Rahul");
    expect(pairDisplayName("Rahul", "   ")).toBe("Rahul");
  });

  test("a missing player falls back to the partner", () => {
    expect(pairDisplayName("", "Amit")).toBe("Amit");
    expect(pairDisplayName(null, "Amit")).toBe("Amit");
  });

  test("both missing yields an empty string, not '&'", () => {
    expect(pairDisplayName(null, undefined)).toBe("");
  });
});

describe("pairKey — order must not create a duplicate entrant", () => {
  test("the same pair keys identically whichever order it was typed", () => {
    expect(pairKey("Rahul & Amit")).toBe(pairKey("Amit & Rahul"));
  });

  test("casing and extra whitespace do not matter", () => {
    expect(pairKey("RAHUL  &  amit")).toBe(pairKey("Amit & Rahul"));
    expect(pairKey("rahul kumar & amit shah")).toBe("amit shah & rahul kumar");
  });

  test("reads names typed without spaces around the ampersand", () => {
    expect(pairKey("Rahul&Amit")).toBe(pairKey("Amit & Rahul"));
  });

  test("a singles entrant keys to just their name", () => {
    expect(pairKey("Rahul")).toBe("rahul");
    expect(pairKey("  Rahul  ")).toBe("rahul");
  });

  test("empty input keys to an empty string", () => {
    expect(pairKey("")).toBe("");
    expect(pairKey(null)).toBe("");
    expect(pairKey(undefined)).toBe("");
  });

  test("different pairs do not collide", () => {
    expect(pairKey("Rahul & Amit")).not.toBe(pairKey("Rahul & Vijay"));
  });
});

describe("isSamePair", () => {
  test("true for the same pair in either order", () => {
    expect(isSamePair("Rahul & Amit", "Amit & Rahul")).toBe(true);
  });

  test("false for different pairs", () => {
    expect(isSamePair("Rahul & Amit", "Rahul & Vijay")).toBe(false);
  });

  test("two empty names are not 'the same pair'", () => {
    expect(isSamePair("", "")).toBe(false);
    expect(isSamePair(null, undefined)).toBe(false);
  });
});

describe("splitPair", () => {
  test("splits a pair into two halves", () => {
    expect(splitPair("Rahul & Amit")).toEqual(["Rahul", "Amit"]);
  });

  test("a singles name yields one half", () => {
    expect(splitPair("Rahul")).toEqual(["Rahul"]);
  });

  test("drops empty halves from a trailing separator", () => {
    expect(splitPair("Rahul &")).toEqual(["Rahul"]);
    expect(splitPair("&")).toEqual([]);
  });
});

describe("namesInEntry — powers the one-person-per-category rule", () => {
  test("lists both people in a pair, normalized", () => {
    expect(namesInEntry("Rahul Kumar & Amit Shah")).toEqual([
      "rahul kumar",
      "amit shah",
    ]);
  });

  test("lists the single person for a singles entry", () => {
    expect(namesInEntry("Rahul")).toEqual(["rahul"]);
  });

  test("an empty entry names nobody", () => {
    expect(namesInEntry("")).toEqual([]);
    expect(namesInEntry(null)).toEqual([]);
  });

  test("a person is detectable whether they entered or were named as partner", () => {
    const ownEntry = namesInEntry("Amit Shah");
    const asPartner = namesInEntry("Rahul Kumar & Amit Shah");
    expect(asPartner).toContain(ownEntry[0]);
  });
});

describe("normalizeName", () => {
  test.each([
    ["  Rahul  ", "rahul"],
    ["RAHUL KUMAR", "rahul kumar"],
    ["Rahul    Kumar", "rahul kumar"],
    ["", ""],
    [null, ""],
    [undefined, ""],
  ])("%s → %s", (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });
});
