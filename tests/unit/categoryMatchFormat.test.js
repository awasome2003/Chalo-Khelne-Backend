/**
 * Per-category groupStageFormat / knockoutFormat resolution (pure).
 *
 * A sport track carries ONE groupStageFormat for all of its categories, and
 * matchController's group-stage generator is the only place in the platform
 * that decides singles vs doubles. It used to resolve from the track alone:
 *
 *     getGroupStageFormat(tournament, group.sportId) === "Doubles"
 *
 * which produced two wrong outcomes on a real multi-sport tournament:
 *
 *   • a Table Tennis track set to "Doubles" generated DOUBLES fixtures for
 *     Men's Singles and Women's Singles;
 *   • a Badminton/Carrom track set to the combined "Singles, Doubles" failed
 *     the strict equality and generated SINGLES fixtures for Men's Doubles,
 *     Women's Doubles and Mixed Doubles.
 *
 * Resolution now goes: category override → single-valued track → category name
 * (for the combined track) → null. These assertions fail if it regresses.
 */
const {
  getGroupStageFormat,
  getKnockoutFormat,
  getCategory,
} = require("../../utils/sportTrackUtils");

const BADMINTON = "69b7ce0cf50e303a19ed610d";
const CARROM = "69b7ce0cf50e303a19ed612e";
const TABLE_TENNIS = "69b7ce0cf50e303a19ed6110";

// Mirrors the shape of the multi-sport championship this was found on.
const tournament = {
  sports: [
    {
      sportId: BADMINTON,
      sportName: "Badminton",
      groupStageFormat: "Singles, Doubles",
      knockoutFormat: "Singles",
      categories: [
        { name: "Men's Singles" },
        { name: "Men's Doubles" },
        { name: "Women's Singles" },
        { name: "Women's Doubles" },
        { name: "Mixed Doubles" },
      ],
    },
    {
      sportId: CARROM,
      sportName: "Carrom",
      groupStageFormat: "Singles, Doubles",
      knockoutFormat: null,
      categories: [{ name: "Singles" }, { name: "Doubles" }],
    },
    {
      sportId: TABLE_TENNIS,
      sportName: "Table Tennis",
      groupStageFormat: "Doubles",
      knockoutFormat: "Doubles",
      categories: [
        { name: "Men's Singles", groupStageFormat: "Singles", knockoutFormat: "Singles" },
        { name: "Men's Doubles", groupStageFormat: "Doubles", knockoutFormat: "Doubles" },
        { name: "Women's Singles", groupStageFormat: "Singles", knockoutFormat: "Singles" },
        { name: "Women's Doubles", groupStageFormat: "Doubles", knockoutFormat: "Doubles" },
        { name: "Mixed Doubles", groupStageFormat: "Doubles", knockoutFormat: "Doubles" },
      ],
    },
  ],
};

describe("getGroupStageFormat — category overrides win over the track", () => {
  test.each([
    ["Men's Singles", "Singles"],
    ["Men's Doubles", "Doubles"],
    ["Women's Singles", "Singles"],
    ["Women's Doubles", "Doubles"],
    ["Mixed Doubles", "Doubles"],
  ])("Table Tennis / %s → %s", (categoryName, expected) => {
    expect(getGroupStageFormat(tournament, TABLE_TENNIS, categoryName)).toBe(expected);
  });

  test("the singles categories no longer inherit the track's Doubles", () => {
    // The exact regression: track says Doubles, category says Singles.
    expect(tournament.sports[2].groupStageFormat).toBe("Doubles");
    expect(getGroupStageFormat(tournament, TABLE_TENNIS, "Men's Singles")).not.toBe("Doubles");
  });
});

describe('getGroupStageFormat — the combined "Singles, Doubles" track', () => {
  test.each([
    ["Men's Singles", "Singles"],
    ["Men's Doubles", "Doubles"],
    ["Women's Singles", "Singles"],
    ["Women's Doubles", "Doubles"],
    ["Mixed Doubles", "Doubles"],
  ])("Badminton / %s → %s", (categoryName, expected) => {
    expect(getGroupStageFormat(tournament, BADMINTON, categoryName)).toBe(expected);
  });

  test.each([
    ["Singles", "Singles"],
    ["Doubles", "Doubles"],
  ])("Carrom / %s → %s", (categoryName, expected) => {
    expect(getGroupStageFormat(tournament, CARROM, categoryName)).toBe(expected);
  });

  test("never returns the combined value — callers compare against one format", () => {
    for (const name of ["Men's Singles", "Men's Doubles", "Mixed Doubles"]) {
      expect(getGroupStageFormat(tournament, BADMINTON, name)).not.toBe("Singles, Doubles");
    }
  });
});

describe("getKnockoutFormat", () => {
  test("uses the category override when present", () => {
    expect(getKnockoutFormat(tournament, TABLE_TENNIS, "Men's Singles")).toBe("Singles");
    expect(getKnockoutFormat(tournament, TABLE_TENNIS, "Mixed Doubles")).toBe("Doubles");
  });

  test("falls through to a single-valued track", () => {
    expect(getKnockoutFormat(tournament, BADMINTON, "Men's Doubles")).toBe("Singles");
  });

  test("is null when neither the track nor the category sets one", () => {
    expect(getKnockoutFormat(tournament, CARROM, "Doubles")).toBeNull();
  });
});

describe("resolution edge cases", () => {
  test("omitting the category keeps the old track-only behaviour", () => {
    expect(getGroupStageFormat(tournament, TABLE_TENNIS)).toBe("Doubles");
  });

  test("an unknown sportId resolves to null rather than throwing", () => {
    expect(getGroupStageFormat(tournament, "f".repeat(24), "Men's Singles")).toBeNull();
  });

  test("an unknown category falls back to the track", () => {
    expect(getGroupStageFormat(tournament, TABLE_TENNIS, "No Such Category")).toBe("Doubles");
  });

  test("category matching is case- and whitespace-insensitive", () => {
    // BookingGroup.category is a free string, so it will not always match the
    // tournament's casing exactly.
    expect(getGroupStageFormat(tournament, TABLE_TENNIS, "  men's singles  ")).toBe("Singles");
    expect(getCategory(tournament, TABLE_TENNIS, "MIXED DOUBLES")?.name).toBe("Mixed Doubles");
  });

  test("a tournament with no sports resolves to null", () => {
    expect(getGroupStageFormat({ sports: [] }, TABLE_TENNIS, "Men's Singles")).toBeNull();
    expect(getGroupStageFormat(null, TABLE_TENNIS, "Men's Singles")).toBeNull();
  });
});
