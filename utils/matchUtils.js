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
 * Returns: { side1Sets, side2Sets } or null
 */
const getScore = (match) => {
  if (!match) return null;

  // Match, DirectKnockoutMatch
  if (match.result?.finalScore) {
    return {
      side1Sets: match.result.finalScore.player1Sets || 0,
      side2Sets: match.result.finalScore.player2Sets || 0,
    };
  }

  // SuperMatch
  if (match.score) {
    return {
      side1Sets: match.score.player1Sets || 0,
      side2Sets: match.score.player2Sets || 0,
    };
  }

  // TeamKnockoutMatch
  if (match.setsWon) {
    return {
      side1Sets: match.setsWon.home || 0,
      side2Sets: match.setsWon.away || 0,
    };
  }

  return null;
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
};
