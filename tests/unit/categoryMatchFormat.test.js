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
  getQualifyPerGroup,
  getDrawSize,
  getTournamentType,
  getFormatScope,
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

// ── Structural settings per category (type / qualifyPerGroup / drawSize) ──
//
// Format alone was not enough for a real tournament: the manager also needs
// "Men's Doubles advances the top 3, Women's Singles the top 2" and
// "Women's Singles is knockout only" inside ONE sport track. These resolve
// with the same category-wins-over-track rule as the format fields.
describe("structural settings resolve per category", () => {
  // The client's actual configuration.
  const t = {
    sports: [
      {
        sportId: TABLE_TENNIS,
        sportName: "Table Tennis",
        formatScope: "category",
        type: "knockout + group stage",
        groupStageFormat: "Singles",
        knockoutFormat: "Singles",
        qualifyPerGroup: 2,
        drawSize: 16,
        categories: [
          {
            name: "Men's Doubles",
            groupStageFormat: "Singles",
            knockoutFormat: "Doubles",
            qualifyPerGroup: 3,
          },
          {
            name: "Women's Singles",
            type: "knockout",
            groupStageFormat: "Doubles",
            knockoutFormat: "Singles",
            qualifyPerGroup: 2,
            drawSize: 32,
          },
          // Inherits everything from the track.
          { name: "Under 19" },
        ],
      },
    ],
  };

  test("qualifyPerGroup — category value wins over the track", () => {
    expect(getQualifyPerGroup(t, TABLE_TENNIS, "Men's Doubles")).toBe(3);
    expect(getQualifyPerGroup(t, TABLE_TENNIS, "Women's Singles")).toBe(2);
  });

  test("qualifyPerGroup — a category without one inherits the track", () => {
    expect(getQualifyPerGroup(t, TABLE_TENNIS, "Under 19")).toBe(2);
    expect(getQualifyPerGroup(t, TABLE_TENNIS)).toBe(2);
  });

  test("qualifyPerGroup — defaults to 2 when neither level sets one", () => {
    expect(getQualifyPerGroup({ sports: [{ sportId: TABLE_TENNIS }] }, TABLE_TENNIS)).toBe(2);
  });

  test("type — a category can run a different stage set than its track", () => {
    expect(getTournamentType(t, TABLE_TENNIS, "Women's Singles")).toBe("knockout");
    expect(getTournamentType(t, TABLE_TENNIS, "Men's Doubles")).toBe("knockout + group stage");
    expect(getTournamentType(t, TABLE_TENNIS)).toBe("knockout + group stage");
  });

  test("drawSize — category wins, otherwise the track, otherwise null", () => {
    expect(getDrawSize(t, TABLE_TENNIS, "Women's Singles")).toBe(32);
    expect(getDrawSize(t, TABLE_TENNIS, "Men's Doubles")).toBe(16);
    expect(getDrawSize({ sports: [{ sportId: TABLE_TENNIS }] }, TABLE_TENNIS)).toBeNull();
  });

  test("the full per-category configuration resolves as the manager entered it", () => {
    // Men's Doubles — group stage in singles, top 3 advance, doubles knockout.
    expect(getGroupStageFormat(t, TABLE_TENNIS, "Men's Doubles")).toBe("Singles");
    expect(getQualifyPerGroup(t, TABLE_TENNIS, "Men's Doubles")).toBe(3);
    expect(getKnockoutFormat(t, TABLE_TENNIS, "Men's Doubles")).toBe("Doubles");

    // Women's Singles — group stage in doubles, top 2 advance, singles knockout.
    expect(getGroupStageFormat(t, TABLE_TENNIS, "Women's Singles")).toBe("Doubles");
    expect(getQualifyPerGroup(t, TABLE_TENNIS, "Women's Singles")).toBe(2);
    expect(getKnockoutFormat(t, TABLE_TENNIS, "Women's Singles")).toBe("Singles");
  });
});

describe("getFormatScope", () => {
  test('reports the track\'s authoring mode, defaulting to "sport"', () => {
    expect(getFormatScope({ sports: [{ sportId: TABLE_TENNIS, formatScope: "category" }] }, TABLE_TENNIS)).toBe("category");
    expect(getFormatScope({ sports: [{ sportId: TABLE_TENNIS }] }, TABLE_TENNIS)).toBe("sport");
  });

  test("does not gate resolution — a category override wins in either mode", () => {
    const sportMode = {
      sports: [{
        sportId: TABLE_TENNIS,
        formatScope: "sport",
        qualifyPerGroup: 2,
        categories: [{ name: "Men's Doubles", qualifyPerGroup: 3 }],
      }],
    };
    expect(getFormatScope(sportMode, TABLE_TENNIS)).toBe("sport");
    expect(getQualifyPerGroup(sportMode, TABLE_TENNIS, "Men's Doubles")).toBe(3);
  });
});
