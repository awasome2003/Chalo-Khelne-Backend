/**
 * Unified Match Utility
 *
 * Provides a single interface to work with matches across all 6 schemas.
 * Instead of rewriting schemas, this adapter normalizes access patterns.
 *
 * Usage:
 *   const { findMatchById, getWinner, getStatus } = require("../utils/matchUtils");
 *   const match = await findMatchById(someId);
 *   const winner = getWinner(match);
 */

const Match = require("../Modal/Tournnamentmatch");
const DirectKnockoutMatch = require("../Modal/DirectKnockoutMatch");
const SuperMatch = require("../Modal/SuperMatch");
const TeamKnockoutMatch = require("../Modal/TeamKnockoutMatches");
const KnockoutMatch = require("../Modal/KnockoutMatch");

// All match models in search priority order
const MATCH_MODELS = [
  { model: Match, name: "Match" },
  { model: DirectKnockoutMatch, name: "DirectKnockoutMatch" },
  { model: SuperMatch, name: "SuperMatch" },
  { model: TeamKnockoutMatch, name: "TeamKnockoutMatch" },
  { model: KnockoutMatch, name: "KnockoutMatch" },
];

/**
 * Find a match by _id across all schemas.
 * Returns { match, schemaName } or null.
 */
const findMatchById = async (matchId) => {
  for (const { model, name } of MATCH_MODELS) {
    try {
      const match = await model.findById(matchId);
      if (match) return { match, schemaName: name };
    } catch {
      // ObjectId cast error or other — skip
    }
  }
  return null;
};

/**
 * Find matches by tournamentId across all schemas.
 * Returns array of { match, schemaName }.
 */
const findMatchesByTournament = async (tournamentId) => {
  const results = [];
  for (const { model, name } of MATCH_MODELS) {
    try {
      const matches = await model.find({ tournamentId });
      for (const match of matches) {
        results.push({ match, schemaName: name });
      }
    } catch {
      // skip
    }
  }
  return results;
};

/**
 * Get normalized winner info from any match schema.
 * Always returns: { playerId, playerName } or null
 *
 * Handles:
 *   Match/DirectKnockout → match.result.winner
 *   SuperMatch           → match.winner
 *   KnockoutMatch        → match.winner
 *   TeamKnockoutMatch    → match.winnerId (ObjectId, no name)
 */
const getWinner = (match) => {
  if (!match) return null;

  // Match, DirectKnockoutMatch → result.winner
  if (match.result?.winner?.playerId) {
    return {
      playerId: match.result.winner.playerId,
      playerName: match.result.winner.playerName || null,
    };
  }

  // SuperMatch, KnockoutMatch → winner.playerId
  if (match.winner?.playerId) {
    return {
      playerId: match.winner.playerId,
      playerName: match.winner.playerName || null,
    };
  }

  // TeamKnockoutMatch → winnerId (ObjectId ref)
  if (match.winnerId) {
    return {
      playerId: match.winnerId,
      playerName: null, // team knockout stores team ID, not player
      isTeam: true,
    };
  }

  return null;
};

/**
 * Get normalized status from any match schema.
 * Always returns uppercase: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"
 */
const getStatus = (match) => {
  if (!match || !match.status) return null;
  return match.status.toUpperCase().replace("-", "_");
};

/**
 * Check if a match is completed (works across all schemas)
 */
const isCompleted = (match) => {
  return getStatus(match) === "COMPLETED";
};

/**
 * Get normalized score from any match schema.
 * Returns: { side1Score, side2Score } or null
 * (Legacy alias: side1Sets/side2Sets still accessible)
 */
const getScore = (match) => {
  if (!match) return null;

  // Match, DirectKnockoutMatch
  if (match.result?.finalScore) {
    const s1 = match.result.finalScore.player1Sets || 0;
    const s2 = match.result.finalScore.player2Sets || 0;
    return { side1Score: s1, side2Score: s2, side1Sets: s1, side2Sets: s2 };
  }

  // SuperMatch
  if (match.score) {
    const s1 = match.score.player1Sets || 0;
    const s2 = match.score.player2Sets || 0;
    return { side1Score: s1, side2Score: s2, side1Sets: s1, side2Sets: s2 };
  }

  // TeamKnockoutMatch
  if (match.setsWon) {
    const s1 = match.setsWon.home || 0;
    const s2 = match.setsWon.away || 0;
    return { side1Score: s1, side2Score: s2, side1Sets: s1, side2Sets: s2 };
  }

  return null;
};

// ════════════════════════════════════
// MULTI-SPORT RESULT ABSTRACTION
// ════════════════════════════════════

const { getScoringType } = require("./matchFormatUtils");

/**
 * Central match result reader — sport-aware, strict mode.
 *
 * PRIORITY:
 *   1. match.matchResult (normalized — preferred after migration)
 *   2. Legacy extraction (match.result/match.winner/match.score) — transitional
 *
 * @param {Object} match — any match document (Match, DirectKnockout, SuperMatch, TeamKnockout)
 * @param {Object} [opts] — { tournament, allowLegacy } for sport detection
 * @returns {{ type, player1Score, player2Score, winner, details, labels }}
 */
const readMatchResult = (match, opts = {}) => {
  if (!match) throw new Error("[readMatchResult] called with null match");

  // ── FAST PATH: use pre-computed matchResult if available ──
  if (match.matchResult && match.matchResult.type) {
    return {
      ...match.matchResult,
      labels: _getLabels(match.matchResult.type),
    };
  }

  // ── LEGACY PATH: extract from old schema fields ──
  // This path is used for non-migrated matches and in-progress matches
  const scoringType = match.matchFormat?.scoringType
    || getScoringType(match.sportsType || opts.tournament?.sportsType)
    || null;

  if (!scoringType) {
    // For in-progress or scheduled matches, default to "sets" for backward compat
    if (!isCompleted(match)) {
      return _buildFromLegacy(match, "sets");
    }
    // For completed matches without scoringType, log warning but don't crash
    console.warn(`[readMatchResult] Match ${match._id} has no scoringType — using legacy extraction`);
    return _buildFromLegacy(match, "sets");
  }

  return _buildFromLegacy(match, scoringType);
};

/**
 * Build result from legacy schema fields.
 * Used during transition period before all matches have matchResult.
 */
function _buildFromLegacy(match, scoringType) {
  const winner = getWinner(match);
  const rawScore = getScore(match);
  const completed = isCompleted(match);

  return {
    type: scoringType,
    completed,
    player1Score: rawScore?.side1Score || 0,
    player2Score: rawScore?.side2Score || 0,
    winner: completed ? winner : null,
    details: _extractDetails(match, scoringType),
    labels: _getLabels(scoringType),
  };
}

/**
 * Sport-neutral labels for display.
 */
function _getLabels(scoringType) {
  switch (scoringType) {
    case "sets":
      return { round: "Set", subRound: "Game", score: "Points", result: "Sets" };
    case "time":
      return { round: "Period", subRound: null, score: "Goals", result: "Score" };
    case "innings":
      return { round: "Innings", subRound: "Over", score: "Runs", result: "Score" };
    case "single":
      return { round: "Game", subRound: null, score: "Result", result: "Result" };
    default:
      return { round: "Round", subRound: null, score: "Score", result: "Score" };
  }
}

/**
 * Extract sport-appropriate details from match internal structure.
 * For sets: returns set/game breakdown.
 * For time/innings/single: returns flat score summary from first "set" container.
 */
function _extractDetails(match, scoringType) {
  const sets = match.sets || [];

  if (scoringType === "sets") {
    // Full set→game breakdown
    return sets.map(s => ({
      roundNumber: s.setNumber,
      status: s.status,
      winner: s.setWinner || s.winner || null,
      subRounds: (s.games || []).map(g => ({
        number: g.gameNumber,
        player1Score: g.finalScore?.player1 ?? 0,
        player2Score: g.finalScore?.player2 ?? 0,
        winner: g.winner || null,
        status: g.status,
      })),
    }));
  }

  // For time/innings/single — the match data is stored as 1 set with 1 game
  // Extract the final scores directly
  if (sets.length > 0 && sets[0].games?.length > 0) {
    const completedGames = sets[0].games.filter(g => g.status === "COMPLETED");
    return completedGames.map(g => ({
      player1Score: g.finalScore?.player1 ?? 0,
      player2Score: g.finalScore?.player2 ?? 0,
    }));
  }

  return [];
}

/**
 * Get sport-neutral display string for a match score.
 * E.g., "3-1" for sets, "150-148" for cricket, "1-0" for chess
 */
const getScoreDisplay = (match, opts = {}) => {
  const result = readMatchResult(match, opts);
  return `${result.player1Score}-${result.player2Score}`;
};

/**
 * Get the next match ID for bracket progression.
 * Returns string or null.
 */
const getNextMatchId = (match) => {
  if (!match) return null;

  // DirectKnockoutMatch, SuperMatch → nextMatchId (string)
  if (match.nextMatchId) return match.nextMatchId;

  // KnockoutMatch → nextMatch.matchId (ObjectId)
  if (match.nextMatch?.matchId) return match.nextMatch.matchId.toString();

  return null;
};

/**
 * Detect which schema a match document belongs to.
 */
const getSchemaName = (match) => {
  if (!match) return null;
  // Mongoose model name
  if (match.constructor?.modelName) return match.constructor.modelName;
  // Fallback: detect by unique fields
  if (match.matchWinner !== undefined) return "TeamKnockoutMatch";
  if (match.mode === "direct-knockout") return "DirectKnockoutMatch";
  if (match.loser !== undefined) return "SuperMatch";
  if (match.nextMatch?.position) return "KnockoutMatch";
  if (match.groupId) return "Match";
  return "Unknown";
};

module.exports = {
  MATCH_MODELS,
  findMatchById,
  findMatchesByTournament,
  getWinner,
  getStatus,
  isCompleted,
  getScore,
  getNextMatchId,
  getSchemaName,
  // Multi-sport abstraction
  readMatchResult,
  getScoreDisplay,
};
