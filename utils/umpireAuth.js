/**
 * umpireAuth — Phase 4 authorization helper for umpire scoring.
 *
 * Determines whether a given umpire (userId) is authorized to score a given match.
 * Two paths to authorization:
 *
 *   A. Match-level grant — an accepted Assignment doc for this specific match.
 *   B. Stage-level grant — an accepted StaffApplication for the tournament,
 *      where `stages` either includes the match's stage or is empty (= all stages,
 *      backward-compat for pre-Phase-4 accepted applications).
 *
 * Match "stage" is derived structurally: presence of `groupId` = "group-stage",
 * absence = "knockout".
 */

"use strict";

const Assignment = require("../Modal/Assignment");
const StaffApplication = require("../Modal/StaffApplication");

/**
 * Pure helper: derives the stage name from a match document.
 * Uses the structural rule: matches with groupId are group-stage; others are knockout.
 *
 * @param {object} match — Match / Tournnamentmatch / DirectKnockoutMatch / SuperMatch / TeamKnockout doc
 * @returns {"group-stage" | "knockout"}
 */
function getMatchStage(match) {
  if (!match) return "knockout"; // safe default for malformed input
  return match.groupId ? "group-stage" : "knockout";
}

/**
 * Async: checks whether the given umpire is authorized to score the given match.
 *
 * @param {string} userId — the umpire's User._id (string or ObjectId)
 * @param {object} match  — the match document (must have _id, tournamentId, and optionally groupId)
 * @returns {Promise<{ authorized: boolean, via?: "match-assignment" | "stage-grant", stage?: string, assignmentId?: string }>}
 */
async function isUmpireAuthorizedForMatch(userId, match) {
  if (!userId || !match || !match._id || !match.tournamentId) {
    return { authorized: false };
  }

  const stage = getMatchStage(match);

  // A. Match-level grant
  const matchAssignment = await Assignment.findOne({
    refereeId: userId,
    matchId: match._id,
    status: "accepted",
  })
    .select("_id")
    .lean();
  if (matchAssignment) {
    return {
      authorized: true,
      via: "match-assignment",
      stage,
      assignmentId: matchAssignment._id.toString(),
    };
  }

  // B. Stage-level grant via accepted StaffApplication
  const staffApp = await StaffApplication.findOne({
    userId,
    tournamentId: match.tournamentId,
    role: "referee",
    status: "accepted",
  })
    .select("stages")
    .lean();

  if (staffApp) {
    const hasExplicitStages = Array.isArray(staffApp.stages) && staffApp.stages.length > 0;
    const stageAllowed = !hasExplicitStages || staffApp.stages.includes(stage);
    if (stageAllowed) {
      return { authorized: true, via: "stage-grant", stage };
    }
  }

  return { authorized: false };
}

module.exports = {
  getMatchStage,
  isUmpireAuthorizedForMatch,
};
