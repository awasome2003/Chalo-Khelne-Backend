/**
 * Central Match Result Validation Engine.
 *
 * Validates match results based on scoringType BEFORE they are persisted.
 * Integrated into: completeGame, bulkResultUpload, and any scoring entry point.
 *
 * Usage:
 *   const { validateMatchResult } = require("../utils/validateMatchResult");
 *   const { valid, errors } = validateMatchResult(matchFormat, { player1Score, player2Score });
 *   if (!valid) return res.status(400).json({ errors });
 */

const { getScoringType } = require("./matchFormatUtils");

/**
 * Validate a match result before persisting.
 *
 * @param {Object} matchFormat — match format config (must include scoringType)
 * @param {Object} result — { player1Score, player2Score, winner?, scoringType? }
 * @param {Object} [opts] — { sportName } for fallback scoringType detection
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateMatchResult(matchFormat, result, opts = {}) {
  const errors = [];

  if (!result) {
    return { valid: false, errors: ["Result object is required"] };
  }

  const scoringType = result.scoringType
    || matchFormat?.scoringType
    || getScoringType(opts.sportName)
    || null;

  if (!scoringType) {
    errors.push("Cannot determine scoringType — matchFormat.scoringType is missing");
    return { valid: false, errors };
  }

  const p1 = result.player1Score;
  const p2 = result.player2Score;

  // Common: scores must be numbers
  if (typeof p1 !== "number" || typeof p2 !== "number") {
    errors.push(`Scores must be numbers (got player1: ${typeof p1}, player2: ${typeof p2})`);
    return { valid: false, errors };
  }

  switch (scoringType) {
    case "sets":
      return _validateSets(matchFormat, p1, p2, errors);

    case "time":
      return _validateTime(p1, p2, errors);

    case "innings":
      return _validateInnings(p1, p2, result, errors);

    case "single":
      return _validateSingle(p1, p2, result, errors);

    case "board":
      return _validateBoard(p1, p2, errors);

    default:
      errors.push(`Unknown scoringType: "${scoringType}"`);
      return { valid: false, errors };
  }
}

// ── SETS VALIDATION ──
function _validateSets(matchFormat, p1, p2, errors) {
  if (p1 < 0 || p2 < 0) errors.push("Set scores cannot be negative");

  const setsToWin = matchFormat?.setsToWin || Math.ceil((matchFormat?.totalSets || 1) / 2);

  if (p1 < setsToWin && p2 < setsToWin) {
    errors.push(`Neither player reached ${setsToWin} sets to win (got ${p1}-${p2})`);
  }

  if (p1 >= setsToWin && p2 >= setsToWin) {
    errors.push(`Both players cannot have ${setsToWin}+ sets won (got ${p1}-${p2})`);
  }

  if (p1 === p2) {
    errors.push(`Set scores cannot be tied (${p1}-${p2})`);
  }

  return { valid: errors.length === 0, errors };
}

// ── TIME VALIDATION ──
function _validateTime(p1, p2, errors) {
  if (p1 < 0 || p2 < 0) errors.push("Scores cannot be negative");
  // Draws are allowed in time-based sports (football)
  // No upper bound validation — basketball can have 100+ points
  return { valid: errors.length === 0, errors };
}

// ── INNINGS VALIDATION ──
// Ties (equal runs) ARE allowed here — cricket can tie and is resolved by
// super-over/rule downstream; never reject equal run totals.
function _validateInnings(p1, p2, result, errors) {
  if (p1 < 0 || p2 < 0) errors.push("Run scores cannot be negative");

  // If details include wickets/overs, validate them
  if (result.details && Array.isArray(result.details)) {
    for (const d of result.details) {
      if (d.player1Wickets !== undefined && (d.player1Wickets < 0 || d.player1Wickets > 10)) {
        errors.push(`Invalid wickets for player 1: ${d.player1Wickets} (must be 0-10)`);
      }
      if (d.player2Wickets !== undefined && (d.player2Wickets < 0 || d.player2Wickets > 10)) {
        errors.push(`Invalid wickets for player 2: ${d.player2Wickets} (must be 0-10)`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── BOARD VALIDATION (Carrom) ──
// Aggregate board points per side. Higher total wins; equal totals are rejected
// (a Carrom match cannot end level).
function _validateBoard(p1, p2, errors) {
  if (p1 < 0 || p2 < 0) errors.push("Board points cannot be negative");
  if (p1 === p2) errors.push(`Board totals cannot be tied (${p1}-${p2})`);
  return { valid: errors.length === 0, errors };
}

// ── SINGLE VALIDATION ──
function _validateSingle(p1, p2, result, errors) {
  // For single-result sports, scores should be 0 or 1
  if (p1 !== 0 && p1 !== 1) errors.push(`Player 1 score must be 0 or 1 for single-result (got ${p1})`);
  if (p2 !== 0 && p2 !== 1) errors.push(`Player 2 score must be 0 or 1 for single-result (got ${p2})`);

  // Both 0 is a draw (valid for chess)
  // Both 1 is invalid
  if (p1 === 1 && p2 === 1) errors.push("Both players cannot win in single-result format");

  return { valid: errors.length === 0, errors };
}

/**
 * Validate individual game/point scores within a set.
 * Used by completeGame to validate per-game scores.
 *
 * @param {number} p1 — player 1 score
 * @param {number} p2 — player 2 score
 * @param {Object} matchFormat — { scoringType, pointsToWinGame, marginToWin, deuceRule }
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateGameScore(p1, p2, matchFormat) {
  const errors = [];
  const scoringType = matchFormat?.scoringType || "sets";

  if (typeof p1 !== "number" || typeof p2 !== "number") {
    return { valid: false, errors: ["Game scores must be numbers"] };
  }

  if (p1 < 0 || p2 < 0) {
    return { valid: false, errors: ["Game scores cannot be negative"] };
  }

  // For non-set sports, any score where someone wins is valid
  // (innings ties are allowed and resolved downstream by super-over/rule).
  if (scoringType === "time" || scoringType === "innings") {
    return { valid: true, errors: [] };
  }

  if (scoringType === "single" || scoringType === "board") {
    // Per-board (carrom) or single-result point entry — any non-negative
    // numbers are acceptable; the win condition is enforced by the engine.
    return { valid: true, errors: [] };
  }

  // For set-based: check pointsToWin and margin rules
  const ptw = matchFormat?.pointsToWinGame;
  const margin = matchFormat?.marginToWin;
  const deuce = matchFormat?.deuceRule;
  // Hard cap (e.g. Badminton 30): at the cap, win-by-1 is legal — a 30-29
  // finish must NOT be rejected for "margin < 2". Coalesce both field names.
  const cap = matchFormat?.maxPointsPerGame || matchFormat?.maxPointsCap || null;

  if (ptw && margin) {
    const maxScore = Math.max(p1, p2);
    const diff = Math.abs(p1 - p2);
    const atCap = cap && maxScore >= cap;

    if (maxScore < ptw) {
      errors.push(`Neither player reached ${ptw} points (got ${p1}-${p2})`);
    } else if (deuce && diff < margin && !atCap) {
      errors.push(`Score ${p1}-${p2} does not satisfy margin of ${margin}`);
    }
  }

  if (p1 === p2) {
    errors.push(`Game scores cannot be tied (${p1}-${p2})`);
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validateMatchResult, validateGameScore };
