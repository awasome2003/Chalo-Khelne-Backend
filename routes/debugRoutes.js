const express = require("express");
const router = express.Router();
const { findMatchById, readMatchResult, getSchemaName } = require("../utils/matchUtils");
const { getScoringType } = require("../utils/matchFormatUtils");
const Tournament = require("../Modal/Tournament");

/**
 * GET /api/debug/match/:id
 * Returns full diagnostic info for a match — used for debugging multi-sport issues.
 */
router.get("/match/:id", async (req, res) => {
  try {
    const result = await findMatchById(req.params.id);
    if (!result) {
      return res.status(404).json({ success: false, message: "Match not found in any collection" });
    }

    const { match, schemaName } = result;

    // Get tournament context
    let tournament = null;
    if (match.tournamentId) {
      tournament = await Tournament.findById(match.tournamentId)
        .select("title sportsType matchFormat currentStage")
        .lean();
    }

    // Derive result through readMatchResult
    let derivedResult = null;
    let derivedError = null;
    try {
      derivedResult = readMatchResult(match, { tournament });
    } catch (err) {
      derivedError = err.message;
    }

    const scoringType = match.matchFormat?.scoringType
      || getScoringType(match.sportsType || tournament?.sportsType)
      || null;

    res.json({
      success: true,
      debug: {
        matchId: match._id,
        schema: schemaName,
        status: match.status,
        sportName: match.sportsType || tournament?.sportsType || null,
        scoringType,

        // What's stored
        hasMatchResult: !!(match.matchResult && match.matchResult.type),
        storedMatchResult: match.matchResult || null,

        // What readMatchResult() returns
        derivedResult,
        derivedError,

        // Match format
        matchFormat: match.matchFormat || null,

        // Legacy fields (for migration debugging)
        legacy: {
          hasResultFinalScore: !!match.result?.finalScore,
          hasSets: !!(match.sets && match.sets.length > 0),
          setsCount: match.sets?.length || 0,
          hasWinner: !!(match.result?.winner || match.winner),
          hasSetsWon: !!match.setsWon,
        },

        // Tournament context
        tournament: tournament ? {
          title: tournament.title,
          sportsType: tournament.sportsType,
          scoringType: tournament.matchFormat?.scoringType,
          currentStage: tournament.currentStage,
        } : null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/debug/tournament/:id/health
 * Returns multi-sport health check for a tournament.
 */
router.get("/tournament/:id/health", async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.id)
      .select("title sportsType matchFormat currentStage")
      .lean();

    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found" });
    }

    const { findMatchesByTournament, readMatchResult } = require("../utils/matchUtils");
    const allMatches = await findMatchesByTournament(req.params.id);

    const health = {
      totalMatches: allMatches.length,
      completed: 0,
      withMatchResult: 0,
      withoutMatchResult: 0,
      scoringTypes: {},
      errors: [],
    };

    for (const { match, schemaName } of allMatches) {
      if ((match.status || "").toUpperCase() === "COMPLETED") {
        health.completed++;
        if (match.matchResult && match.matchResult.type) {
          health.withMatchResult++;
        } else {
          health.withoutMatchResult++;
        }
      }

      try {
        const r = readMatchResult(match, { tournament });
        health.scoringTypes[r.type] = (health.scoringTypes[r.type] || 0) + 1;
      } catch (err) {
        health.errors.push({ matchId: match._id, schema: schemaName, error: err.message });
      }
    }

    health.migrationComplete = health.withoutMatchResult === 0;

    res.json({ success: true, tournament: tournament.title, sportsType: tournament.sportsType, health });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
