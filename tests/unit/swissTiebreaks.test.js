"use strict";
/**
 * Swiss tiebreaks.
 *
 * Score alone cannot rank a Swiss field — over 5 rounds a 32-player event
 * reliably leaves several players level. These measures separate them by the
 * strength of the opposition each actually faced, which is what makes the final
 * order defensible when a participant asks why they finished below someone on
 * the same points.
 */
const {
  buchholz,
  medianBuchholz,
  sonnebornBerger,
  rankStandings,
} = require("../../utils/swissPairing");

// A small field: a beat b and c; b and d drew; and so on.
const SCORES = { a: 4, b: 3, c: 2, d: 1, e: 0 };

describe("buchholz", () => {
  test("sums the scores of everyone a player met", () => {
    expect(buchholz(["b", "c", "d"], SCORES)).toBe(6); // 3 + 2 + 1
  });

  test("a player with no opponents scores zero", () => {
    expect(buchholz([], SCORES)).toBe(0);
  });

  test("unknown opponents contribute nothing rather than NaN", () => {
    expect(buchholz(["b", "ghost"], SCORES)).toBe(3);
  });

  test("a harder draw beats an easier one on the same score", () => {
    const hard = buchholz(["a", "b"], SCORES);   // 4 + 3
    const easy = buchholz(["d", "e"], SCORES);   // 1 + 0
    expect(hard).toBeGreaterThan(easy);
  });
});

describe("medianBuchholz", () => {
  test("drops the highest and lowest opponent", () => {
    // a=4, b=3, c=2, d=1, e=0 → drop 4 and 0 → 3 + 2 + 1
    expect(medianBuchholz(["a", "b", "c", "d", "e"], SCORES)).toBe(6);
  });

  test("with two or fewer opponents there is nothing to trim", () => {
    expect(medianBuchholz(["a", "b"], SCORES)).toBe(7);
    expect(medianBuchholz(["a"], SCORES)).toBe(4);
  });

  test("blunts a single freak result", () => {
    const withOutlier = medianBuchholz(["a", "b", "c", "e"], SCORES);
    // The 0-score opponent is trimmed away rather than dragging the total down.
    expect(withOutlier).toBe(buchholz(["b", "c"], SCORES));
  });
});

describe("sonnebornBerger", () => {
  test("counts a beaten opponent in full and a drawn one at half", () => {
    // beat b (3) and d (1) = 4; drew with a (4) = 2 → 6
    expect(sonnebornBerger({ beat: ["b", "d"], drew: ["a"] }, SCORES)).toBe(6);
  });

  test("beating a strong player is worth more than beating a weak one", () => {
    const strong = sonnebornBerger({ beat: ["a"] }, SCORES);
    const weak = sonnebornBerger({ beat: ["e"] }, SCORES);
    expect(strong).toBeGreaterThan(weak);
  });

  test("handles missing input", () => {
    expect(sonnebornBerger({}, SCORES)).toBe(0);
    expect(sonnebornBerger(undefined, SCORES)).toBe(0);
  });
});

describe("rankStandings", () => {
  const row = (name, score, bh = 0, sb = 0, won = 0) =>
    ({ name, score, buchholz: bh, sonnebornBerger: sb, won });

  test("orders by score first", () => {
    const out = rankStandings([row("Low", 1), row("High", 3), row("Mid", 2)]);
    expect(out.map((r) => r.name)).toEqual(["High", "Mid", "Low"]);
    expect(out[0].rank).toBe(1);
  });

  test("breaks a score tie on Buchholz", () => {
    const out = rankStandings([
      row("EasyDraw", 4, 10),
      row("HardDraw", 4, 18),
    ]);
    expect(out[0].name).toBe("HardDraw");
    expect(out[0].rank).toBe(1);
    expect(out[1].rank).toBe(2);
  });

  test("falls through to Sonneborn-Berger when Buchholz also ties", () => {
    const out = rankStandings([
      row("BeatWeak", 4, 12, 5),
      row("BeatStrong", 4, 12, 9),
    ]);
    expect(out[0].name).toBe("BeatStrong");
  });

  test("then wins, then name", () => {
    const byWins = rankStandings([
      row("Fewer", 4, 12, 5, 3),
      row("More", 4, 12, 5, 4),
    ]);
    expect(byWins[0].name).toBe("More");

    const byName = rankStandings([row("Zoe", 4, 12, 5, 4), row("Adam", 4, 12, 5, 4)]);
    expect(byName.map((r) => r.name)).toEqual(["Adam", "Zoe"]);
  });

  test("players level on EVERY measure share a rank and are flagged", () => {
    const out = rankStandings([
      row("A", 4, 12, 5, 4),
      row("B", 4, 12, 5, 4),
      row("C", 2, 8, 2, 2),
    ]);
    expect(out[0].rank).toBe(1);
    expect(out[1].rank).toBe(1);
    expect(out[0].tied).toBe(true);
    expect(out[1].tied).toBe(true);
    // The next player takes the rank their position implies, not 2.
    expect(out[2].rank).toBe(3);
    expect(out[2].tied).toBe(false);
  });

  test("a player separated by a tiebreak is NOT flagged as tied", () => {
    const out = rankStandings([row("A", 4, 18), row("B", 4, 10)]);
    expect(out.every((r) => r.tied === false)).toBe(true);
  });

  test("does not mutate the input array order", () => {
    const input = [row("Low", 1), row("High", 3)];
    rankStandings(input);
    expect(input[0].name).toBe("Low");
  });

  test("handles an empty field", () => {
    expect(rankStandings([])).toEqual([]);
  });
});
