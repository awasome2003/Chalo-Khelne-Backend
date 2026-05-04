/**
 * Multi-Sport E2E Test Suite
 *
 * Tests the entire scoring pipeline for all 4 scoring types:
 * - sets (Table Tennis / Badminton)
 * - time (Football / Basketball)
 * - innings (Cricket)
 * - single (Chess / Carrom)
 *
 * Run: npx jest tests/multiSport.test.js --verbose
 * (Requires: npm install --save-dev jest)
 */

const { readMatchResult, getScoreDisplay, getScore, getWinner, isCompleted } = require("../utils/matchUtils");
const { getScoringType } = require("../utils/matchFormatUtils");
const { validateMatchResult, validateGameScore } = require("../utils/validateMatchResult");

// ═══════════════════════════════════════════════════
// 1. getScoringType — sport detection
// ═══════════════════════════════════════════════════

describe("getScoringType", () => {
  test("returns 'sets' for Table Tennis", () => {
    expect(getScoringType("Table Tennis")).toBe("sets");
  });

  test("returns 'sets' for Badminton (case-insensitive)", () => {
    expect(getScoringType("badminton")).toBe("sets");
  });

  test("returns 'time' for Football", () => {
    expect(getScoringType("Football")).toBe("time");
  });

  test("returns 'time' for Basketball", () => {
    expect(getScoringType("Basketball")).toBe("time");
  });

  test("returns 'innings' for Cricket", () => {
    expect(getScoringType("Cricket")).toBe("innings");
  });

  test("returns 'single' for Chess", () => {
    expect(getScoringType("Chess")).toBe("single");
  });

  test("returns null for unknown sport", () => {
    expect(getScoringType("Underwater Hockey")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(getScoringType("")).toBeNull();
  });

  test("returns null for null", () => {
    expect(getScoringType(null)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════
// 2. readMatchResult — FAST PATH (matchResult field)
// ═══════════════════════════════════════════════════

describe("readMatchResult — fast path", () => {
  test("returns matchResult directly when present", () => {
    const match = {
      matchResult: { type: "time", completed: true, player1Score: 1, player2Score: 0, winner: { playerId: "1" }, details: [] },
    };
    const result = readMatchResult(match);
    expect(result.type).toBe("time");
    expect(result.player1Score).toBe(1);
    expect(result.labels.score).toBe("Goals");
  });

  test("handles sets matchResult", () => {
    const match = {
      matchResult: { type: "sets", completed: true, player1Score: 3, player2Score: 1, winner: { playerId: "1" }, details: [] },
    };
    const result = readMatchResult(match);
    expect(result.type).toBe("sets");
    expect(result.player1Score).toBe(3);
    expect(result.labels.round).toBe("Set");
  });

  test("handles innings matchResult", () => {
    const match = {
      matchResult: { type: "innings", completed: true, player1Score: 1, player2Score: 0, winner: { playerId: "1" }, details: [{ player1Score: 150, player2Score: 145 }] },
    };
    const result = readMatchResult(match);
    expect(result.type).toBe("innings");
    expect(result.labels.score).toBe("Runs");
  });

  test("handles single matchResult", () => {
    const match = {
      matchResult: { type: "single", completed: true, player1Score: 1, player2Score: 0, winner: { playerId: "1" }, details: [{ result: "1-0" }] },
    };
    const result = readMatchResult(match);
    expect(result.type).toBe("single");
    expect(result.labels.result).toBe("Result");
  });
});

// ═══════════════════════════════════════════════════
// 3. readMatchResult — LEGACY PATH (no matchResult)
// ═══════════════════════════════════════════════════

describe("readMatchResult — legacy path", () => {
  test("extracts from match.result.finalScore (sets)", () => {
    const match = {
      _id: "test1",
      status: "COMPLETED",
      matchFormat: { scoringType: "sets" },
      result: { winner: { playerId: "1", playerName: "Alice" }, finalScore: { player1Sets: 3, player2Sets: 1 } },
      player1: { playerId: "1" },
      player2: { playerId: "2" },
    };
    const result = readMatchResult(match);
    expect(result.completed).toBe(true);
    expect(result.player1Score).toBe(3);
    expect(result.player2Score).toBe(1);
    expect(result.type).toBe("sets");
  });

  test("extracts from match.score (SuperMatch)", () => {
    const match = {
      _id: "test2",
      status: "COMPLETED",
      matchFormat: { scoringType: "sets" },
      winner: { playerId: "1", playerName: "Alice" },
      score: { player1Sets: 2, player2Sets: 0 },
    };
    const result = readMatchResult(match);
    expect(result.player1Score).toBe(2);
    expect(result.player2Score).toBe(0);
  });

  test("extracts from match.setsWon (TeamKnockout)", () => {
    const match = {
      _id: "test3",
      status: "COMPLETED",
      matchFormat: { scoringType: "sets" },
      winnerId: "team1",
      setsWon: { home: 3, away: 2 },
    };
    const result = readMatchResult(match);
    expect(result.player1Score).toBe(3);
    expect(result.player2Score).toBe(2);
  });

  test("returns partial state for in-progress match", () => {
    const match = {
      _id: "test4",
      status: "IN_PROGRESS",
      matchFormat: { scoringType: "time" },
    };
    const result = readMatchResult(match);
    expect(result.completed).toBe(false);
    expect(result.winner).toBeNull();
  });

  test("throws on null match", () => {
    expect(() => readMatchResult(null)).toThrow();
  });
});

// ═══════════════════════════════════════════════════
// 4. validateMatchResult — all scoring types
// ═══════════════════════════════════════════════════

describe("validateMatchResult", () => {
  // SETS
  test("sets: valid 3-1 result", () => {
    const r = validateMatchResult({ scoringType: "sets", setsToWin: 3 }, { player1Score: 3, player2Score: 1 });
    expect(r.valid).toBe(true);
  });

  test("sets: invalid tied result", () => {
    const r = validateMatchResult({ scoringType: "sets", setsToWin: 3 }, { player1Score: 2, player2Score: 2 });
    expect(r.valid).toBe(false);
  });

  test("sets: invalid insufficient sets", () => {
    const r = validateMatchResult({ scoringType: "sets", setsToWin: 3 }, { player1Score: 2, player2Score: 1 });
    expect(r.valid).toBe(false);
  });

  test("sets: invalid both winning", () => {
    const r = validateMatchResult({ scoringType: "sets", setsToWin: 3 }, { player1Score: 3, player2Score: 3 });
    expect(r.valid).toBe(false);
  });

  // TIME
  test("time: valid football 3-1", () => {
    const r = validateMatchResult({ scoringType: "time" }, { player1Score: 3, player2Score: 1 });
    expect(r.valid).toBe(true);
  });

  test("time: draw 0-0 is valid", () => {
    const r = validateMatchResult({ scoringType: "time" }, { player1Score: 0, player2Score: 0 });
    expect(r.valid).toBe(true);
  });

  test("time: negative score invalid", () => {
    const r = validateMatchResult({ scoringType: "time" }, { player1Score: -1, player2Score: 0 });
    expect(r.valid).toBe(false);
  });

  // INNINGS
  test("innings: valid cricket 150 vs 145", () => {
    const r = validateMatchResult({ scoringType: "innings" }, { player1Score: 1, player2Score: 0, details: [{ player1Score: 150, player2Score: 145 }] });
    expect(r.valid).toBe(true);
  });

  test("innings: invalid wickets > 10", () => {
    const r = validateMatchResult({ scoringType: "innings" }, { player1Score: 1, player2Score: 0, details: [{ player1Wickets: 15 }] });
    expect(r.valid).toBe(false);
  });

  // SINGLE
  test("single: valid 1-0 (white wins)", () => {
    const r = validateMatchResult({ scoringType: "single" }, { player1Score: 1, player2Score: 0 });
    expect(r.valid).toBe(true);
  });

  test("single: valid 0-0 (draw)", () => {
    const r = validateMatchResult({ scoringType: "single" }, { player1Score: 0, player2Score: 0 });
    expect(r.valid).toBe(true);
  });

  test("single: invalid both win", () => {
    const r = validateMatchResult({ scoringType: "single" }, { player1Score: 1, player2Score: 1 });
    expect(r.valid).toBe(false);
  });

  test("single: invalid score > 1", () => {
    const r = validateMatchResult({ scoringType: "single" }, { player1Score: 3, player2Score: 0 });
    expect(r.valid).toBe(false);
  });

  // EDGE CASES
  test("missing scoringType throws", () => {
    const r = validateMatchResult({}, { player1Score: 1, player2Score: 0 });
    expect(r.valid).toBe(false);
  });

  test("non-numeric scores rejected", () => {
    const r = validateMatchResult({ scoringType: "sets" }, { player1Score: "three", player2Score: 1 });
    expect(r.valid).toBe(false);
  });

  test("null result rejected", () => {
    const r = validateMatchResult({ scoringType: "sets" }, null);
    expect(r.valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════
// 5. validateGameScore — per-game validation
// ═══════════════════════════════════════════════════

describe("validateGameScore", () => {
  test("sets: valid 11-8 game", () => {
    const r = validateGameScore(11, 8, { scoringType: "sets", pointsToWinGame: 11, marginToWin: 2, deuceRule: true });
    expect(r.valid).toBe(true);
  });

  test("sets: deuce 12-10 valid", () => {
    const r = validateGameScore(12, 10, { scoringType: "sets", pointsToWinGame: 11, marginToWin: 2, deuceRule: true });
    expect(r.valid).toBe(true);
  });

  test("sets: deuce 11-10 invalid (margin not met)", () => {
    const r = validateGameScore(11, 10, { scoringType: "sets", pointsToWinGame: 11, marginToWin: 2, deuceRule: true });
    expect(r.valid).toBe(false);
  });

  test("time: 3-1 valid", () => {
    const r = validateGameScore(3, 1, { scoringType: "time" });
    expect(r.valid).toBe(true);
  });

  test("time: 0-0 draw valid", () => {
    const r = validateGameScore(0, 0, { scoringType: "time" });
    expect(r.valid).toBe(true);
  });

  test("innings: 150-145 valid", () => {
    const r = validateGameScore(150, 145, { scoringType: "innings" });
    expect(r.valid).toBe(true);
  });

  test("negative score invalid", () => {
    const r = validateGameScore(-1, 5, { scoringType: "sets" });
    expect(r.valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════
// 6. getScoreDisplay
// ═══════════════════════════════════════════════════

describe("getScoreDisplay", () => {
  test("returns formatted score from matchResult", () => {
    const match = { matchResult: { type: "sets", completed: true, player1Score: 3, player2Score: 1 } };
    expect(getScoreDisplay(match)).toBe("3-1");
  });

  test("returns formatted score from legacy", () => {
    const match = {
      _id: "x", status: "COMPLETED", matchFormat: { scoringType: "time" },
      result: { winner: { playerId: "1" }, finalScore: { player1Sets: 1, player2Sets: 0 } },
      player1: { playerId: "1" }, player2: { playerId: "2" },
    };
    expect(getScoreDisplay(match)).toBe("1-0");
  });
});

// ═══════════════════════════════════════════════════
// 7. Labels — sport-specific display
// ═══════════════════════════════════════════════════

describe("Labels per sport type", () => {
  test("sets labels", () => {
    const match = { matchResult: { type: "sets", completed: true, player1Score: 3, player2Score: 1 } };
    const r = readMatchResult(match);
    expect(r.labels.round).toBe("Set");
    expect(r.labels.subRound).toBe("Game");
    expect(r.labels.score).toBe("Points");
  });

  test("time labels", () => {
    const match = { matchResult: { type: "time", completed: true, player1Score: 1, player2Score: 0 } };
    const r = readMatchResult(match);
    expect(r.labels.round).toBe("Period");
    expect(r.labels.score).toBe("Goals");
  });

  test("innings labels", () => {
    const match = { matchResult: { type: "innings", completed: true, player1Score: 1, player2Score: 0 } };
    const r = readMatchResult(match);
    expect(r.labels.round).toBe("Innings");
    expect(r.labels.score).toBe("Runs");
  });

  test("single labels", () => {
    const match = { matchResult: { type: "single", completed: true, player1Score: 1, player2Score: 0 } };
    const r = readMatchResult(match);
    expect(r.labels.round).toBe("Game");
    expect(r.labels.result).toBe("Result");
  });
});

// ═══════════════════════════════════════════════════
// 8. hasNestedGames — shape detection
// ═══════════════════════════════════════════════════

describe("hasNestedGames", () => {
  const { hasNestedGames } = require("../factories/MatchFactory");

  test("returns false for null/undefined/non-object", () => {
    expect(hasNestedGames(null)).toBe(false);
    expect(hasNestedGames(undefined)).toBe(false);
    expect(hasNestedGames("string")).toBe(false);
  });

  test("returns true when gamesPerSet > 0", () => {
    expect(hasNestedGames({ gamesPerSet: 6 })).toBe(true);
    expect(hasNestedGames({ matchFormat: { gamesPerSet: 4 } })).toBe(true);
  });

  test("returns false when gamesPerSet is 0 or null", () => {
    expect(hasNestedGames({ gamesPerSet: 0 })).toBe(false);
    expect(hasNestedGames({ gamesPerSet: null })).toBe(false);
  });

  test("returns true when totalGames > 1 AND differs from totalSets", () => {
    expect(hasNestedGames({ totalSets: 3, totalGames: 6 })).toBe(true);
  });

  test("returns false when totalGames equals totalSets (flat fallback)", () => {
    expect(hasNestedGames({ totalSets: 5, totalGames: 5 })).toBe(false);
  });

  test("returns false for TT preset shape (totalSets, pointsPerSet only)", () => {
    expect(hasNestedGames({ totalSets: 5, pointsPerSet: 11 })).toBe(false);
  });

  test("returns true for Tennis preset shape", () => {
    expect(hasNestedGames({ totalSets: 3, gamesPerSet: 6, pointsPerGame: 4 })).toBe(true);
  });

  test("accepts a tournament object and reads .matchFormat", () => {
    const tournament = { matchFormat: { totalSets: 5, pointsPerSet: 11 } };
    expect(hasNestedGames(tournament)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════
// 9. readMatchFormat — shape awareness
// ═══════════════════════════════════════════════════

describe("readMatchFormat — shape awareness", () => {
  const { readMatchFormat } = require("../utils/matchFormatUtils");

  test("flat TT with null games fields passes validation", () => {
    const match = {
      _id: "tt-flat",
      matchFormat: {
        scoringType: "sets",
        totalSets: 5, setsToWin: 3,
        totalGames: null, gamesToWin: null,
        pointsToWinGame: 11, marginToWin: 2, deuceRule: true,
      },
    };
    const r = readMatchFormat(match);
    expect(r.gamesToWin).toBeNull();
    expect(r.totalGames).toBeNull();
  });

  test("nested Tennis keeps games layer values", () => {
    const match = {
      _id: "tennis",
      matchFormat: {
        scoringType: "sets",
        totalSets: 3, setsToWin: 2,
        totalGames: 6, gamesToWin: 4, gamesPerSet: 6,
        pointsToWinGame: 4, marginToWin: 2, deuceRule: false,
      },
    };
    const r = readMatchFormat(match);
    expect(r.gamesToWin).toBe(4);
    expect(r.totalGames).toBe(6);
  });

  test("legacy TT with equal totalSets==totalGames validates (nested=false, no derivation needed)", () => {
    const match = {
      _id: "tt-legacy",
      matchFormat: {
        scoringType: "sets",
        totalSets: 5, setsToWin: 3,
        totalGames: 5, gamesToWin: 3,
        pointsToWinGame: 11, marginToWin: 2, deuceRule: true,
      },
    };
    const r = readMatchFormat(match);
    expect(r.totalSets).toBe(5);
    expect(r.gamesToWin).toBe(3);
  });

  test("nested format missing gamesToWin derives from totalGames", () => {
    const match = {
      _id: "tennis-missing",
      matchFormat: {
        scoringType: "sets",
        totalSets: 3, setsToWin: 2,
        totalGames: 6, gamesToWin: null, gamesPerSet: 6,
        pointsToWinGame: 4, marginToWin: 2, deuceRule: false,
      },
    };
    const r = readMatchFormat(match);
    expect(r.gamesToWin).toBe(3); // ceil(6/2)
  });
});

// ═══════════════════════════════════════════════════
// 10. resolveMatchFormat — shape branching
// ═══════════════════════════════════════════════════

describe("resolveMatchFormat — shape branching", () => {
  const { resolveMatchFormat, hasNestedGames } = require("../factories/MatchFactory");

  test("TT tournament produces flat-shape frozen format", () => {
    // STEP 17b.iii — multi-sport shape: per-sport config in sports[].
    const tournament = {
      sports: [{
        sportName: "Table Tennis",
        matchFormat: {
          scoringType: "sets",
          totalSets: 5, pointsPerSet: 11, winByMargin: 2, deuceEnabled: true,
        },
      }],
    };
    const frozen = resolveMatchFormat(tournament);
    expect(frozen.scoringType).toBe("sets");
    expect(hasNestedGames(frozen)).toBe(false);
  });

  test("Tennis tournament produces nested-shape frozen format", () => {
    // Post-normalizeMatchFormat shape: totalGames is populated from gamesPerSet.
    // In production, tournaments go through normalizeMatchFormat before save, which
    // sets totalGames = gamesPerSet (Tennis 6), ensuring freeze preserves the nested signal.
    // STEP 17b.iii — multi-sport shape: per-sport config in sports[].
    const tournament = {
      sports: [{
        sportName: "Tennis",
        matchFormat: {
          scoringType: "sets",
          totalSets: 3, totalGames: 6, gamesToWin: 4,
          gamesPerSet: 6, pointsPerGame: 4, winByMargin: 2,
        },
      }],
    };
    const frozen = resolveMatchFormat(tournament);
    expect(frozen.scoringType).toBe("sets");
    expect(hasNestedGames(frozen)).toBe(true);
  });

  test("throws on null tournament", () => {
    expect(() => resolveMatchFormat(null)).toThrow();
  });
});
