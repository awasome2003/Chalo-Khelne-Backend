/**
 * umpireAuth — Phase 4 authorization helper for umpire scoring.
 *
 * Determines whether a given umpire (userId) is authorized to score a given match.
 * Grant paths (evaluated in order):
 *
 *   A. Match-level grant — an accepted Assignment doc for this specific match.
 *      Always wins (explicit override).
 *   C. Court-based grant (EXCLUSIVE) — if the umpire is assigned to ANY court in
 *      the tournament (Tournament.courts[].assignedUmpire), they are STRICTLY
 *      limited to their court(s): authorized only when match.courtNumber is one
 *      of their courts, and the stage grant below is suppressed for them.
 *   B. Stage-level grant — for NON-court umpires only: an accepted
 *      StaffApplication whose `stages` include the match's stage (empty = all).
 *
 * Match "stage" is derived structurally: presence of `groupId` = "group-stage",
 * absence = "knockout".
 */

"use strict";

const Assignment = require("../src/modules/tournaments/models/Assignment");
const StaffApplication = require("../src/modules/social/models/StaffApplication");

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

  // A. Match-level grant — an explicit per-match assignment always wins.
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

  // Court-scoping check. If this umpire is assigned to ANY court in the
  // tournament, they are STRICTLY limited to their court(s): they can score a
  // match only if it's played on one of their courts — the blanket stage grant
  // is suppressed for them. (Non-court umpires fall through to the stage path.)
  const Tournament = require("../src/modules/tournaments/models/Tournament");
  const t = await Tournament.findById(match.tournamentId).select("courts").lean();
  const myCourts = (t?.courts || [])
    .filter((c) => c?.assignedUmpire?.refereeId && String(c.assignedUmpire.refereeId) === String(userId))
    .map((c) => String(c.name).trim().toLowerCase());

  if (myCourts.length > 0) {
    // C. Court-based grant — exclusive: only this umpire's court(s).
    const rawCourt = match.courtNumber != null ? String(match.courtNumber).trim() : "";
    if (rawCourt && rawCourt !== "TBD" && rawCourt !== "BYE" && myCourts.includes(rawCourt.toLowerCase())) {
      return { authorized: true, via: "court-grant", stage, court: rawCourt };
    }
    return { authorized: false, courtScoped: true, courts: myCourts };
  }

  // B. Stage-level grant via accepted StaffApplication (non-court umpires only).
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
