const mongoose = require("mongoose");
const Match = require("../src/modules/tournaments/models/Tournnamentmatch");
const Tournament = require("../src/modules/tournaments/models/Tournament");
const BookingGroup = require("../src/modules/tournaments/models/bookinggroup");
const Booking = require("../src/modules/tournaments/models/BookingModel");
const Referee = require("../src/modules/catalog/models/Referee");
const { freezeMatchFormat, getScoringType } = require("../utils/matchFormatUtils");
const { createGroupStageMatch } = require("../factories/MatchFactory");
const { assertGroupHasSport, handleSportContextError } = require("../middleware/requireSportContext");

// Create Matches — already provided
const createMatches = async (req, res) => {
  try {
    const { tournamentId, groupId, matches } = req.body;

    if (!tournamentId || !groupId || !Array.isArray(matches) || matches.length === 0) {
      return res.status(400).json({
        success: false,
        message: "tournamentId, groupId, and at least one match are required.",
      });
    }

    // Validate tournament and group
    const tournamentExists = await Tournament.findById(tournamentId);
    if (!tournamentExists) {
      return res.status(404).json({ success: false, message: "Tournament not found." });
    }

    const groupExists = await BookingGroup.findById(groupId);
    if (!groupExists) {
      return res.status(404).json({ success: false, message: "Group not found." });
    }

    // STEP 16d — group-derived sportId. Match inherits the group's
    // sportId; if the group is unmigrated/orphaned (no sportId), refuse
    // rather than silently fall back to tournament.sports[0].
    let _resolvedSportId;
    try {
      _resolvedSportId = assertGroupHasSport(groupExists);
    } catch (err) {
      if (handleSportContextError(err, res)) return;
      throw err;
    }

    // Collect all valid playerIds from group
    const validPlayerIds = new Set(groupExists.players.map(p => p.playerId.toString()));

    // Resolve match format override: group-level takes priority over tournament-level
    const matchFormatOverride = (groupExists.matchFormat && (groupExists.matchFormat.totalSets || groupExists.matchFormat.scoringType))
      ? groupExists.matchFormat
      : null;

    const matchDocuments = [];

    for (const match of matches) {
      const {
        matchNumber,
        player1,
        player2,
        referee,
        courtNumber,
        startTime,
      } = match;

      // Basic validation
      if (!player1?.playerId || !player1?.userName) {
        return res.status(400).json({ success: false, message: "player1 object is invalid." });
      }

      if (!player2?.playerId || !player2?.userName) {
        return res.status(400).json({ success: false, message: "player2 object is invalid." });
      }

      // Ensure players belong to this group
      if (!validPlayerIds.has(player1.playerId.toString())) {
        return res.status(404).json({ success: false, message: `player1 ID ${player1.playerId} not found in group.` });
      }

      if (!validPlayerIds.has(player2.playerId.toString())) {
        return res.status(404).json({ success: false, message: `player2 ID ${player2.playerId} not found in group.` });
      }

      // Referee is optional
      let refereeData = null;
      if (referee?.refereeId) {
        const refereeExists = await Referee.findById(referee.refereeId);
        if (refereeExists) {
          refereeData = referee;
        }
      }

      matchDocuments.push(createGroupStageMatch({
        tournament: tournamentExists,
        tournamentId,
        sportId: _resolvedSportId,
        groupId,
        matchNumber,
        player1,
        player2,
        referee: refereeData,
        courtNumber,
        startTime,
        matchFormatOverride,
      }));
    }

    const createdMatches = await Match.insertMany(matchDocuments);

    res.status(201).json({
      success: true,
      message: "Matches created successfully",
      matches: createdMatches,
    });

  } catch (error) {
    console.error("[MATCH_CREATE] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create matches",
      error: error.message,
    });
  }
};

// Get Matches by Group — already implemented
const getMatchesByGroup = async (req, res) => {
  try {
    const { tournamentId, groupId } = req.params;

    if (!tournamentId || !groupId) {
      return res.status(400).json({
        success: false,
        message: "Tournament ID and Group ID are required",
      });
    }

    const matches = await Match.find({ tournamentId, groupId })
      .populate({
        path: 'player1',
        populate: {
          path: 'userId',
          select: 'name profileImage',
        },
      })
      .populate({
        path: 'player2',
        populate: {
          path: 'userId',
          select: 'name profileImage',
        },
      })
      .populate('tournamentId', 'title type')
      .populate('referee', 'name profileImage contact'); // 👈 updated here

    if (!matches || matches.length === 0) {
      return res.status(200).json({
        success: false,
        message: "No matches found",
        matches: [],
      });
    }

    res.status(200).json({
      success: true,
      matches,
    });

  } catch (error) {
    console.error("Error fetching matches:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch matches",
      error: error.message,
    });
  }
};

// ✅ Edit a Match
const updateMatch = async (req, res) => {
  try {
    const { matchId } = req.params;
    const updates = req.body;

    // Look up across ALL match models so knockout / super / team matches can be
    // edited too (the group `Match` model alone 404s for those ids).
    const { findMatchById } = require("../utils/matchUtils");
    const found = await findMatchById(matchId);
    if (!found) {
      return res.status(404).json({ success: false, message: "Match not found." });
    }

    // Optional: Validate updated player1, player2, referee if provided
    if (updates.player1 && !(await Booking.findById(updates.player1))) {
      return res.status(404).json({ success: false, message: "player1 not found." });
    }

    if (updates.player2 && !(await Booking.findById(updates.player2))) {
      return res.status(404).json({ success: false, message: "player2 not found." });
    }

    if (updates.referee && !(await Referee.findById(updates.referee))) {
      return res.status(404).json({ success: false, message: "referee not found." });
    }

    if (updates.startTime) updates.startTime = new Date(updates.startTime);
    if (updates.startDate) updates.startDate = new Date(updates.startDate);

    // Update on the match's OWN model (found.match.constructor), preserving the
    // existing findByIdAndUpdate semantics.
    const updatedMatch = await found.match.constructor.findByIdAndUpdate(matchId, updates, { new: true });

    res.status(200).json({
      success: true,
      message: "Match updated successfully",
      match: updatedMatch,
    });

  } catch (error) {
    console.error("Error updating match:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update match",
      error: error.message,
    });
  }
};

// ✅ Delete a Match
const deleteMatch = async (req, res) => {
  try {
    const { matchId } = req.params;

    const match = await Match.findById(matchId);
    if (!match) {
      return res.status(404).json({ success: false, message: "Match not found." });
    }

    await Match.findByIdAndDelete(matchId);

    res.status(200).json({
      success: true,
      message: "Match deleted successfully",
    });

  } catch (error) {
    console.error("Error deleting match:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete match",
      error: error.message,
    });
  }
};

// Delete all matches for a specific group
const deleteGroupMatches = async (req, res) => {
  try {
    const { tournamentId, groupId } = req.params;

    if (!tournamentId || !groupId) {
      return res.status(400).json({ success: false, message: "Tournament ID and Group ID are required" });
    }

    const result = await Match.deleteMany({ tournamentId, groupId });

    res.status(200).json({
      success: true,
      message: `Deleted ${result.deletedCount} matches from this group`,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("Error deleting group matches:", error);
    res.status(500).json({ success: false, message: "Failed to delete group matches", error: error.message });
  }
};

// Internal helper — generate matches for ONE group. Used by both the single
// HTTP handler and the bulk endpoint. Returns a structured result rather than
// writing to res, so the bulk caller can aggregate per-group outcomes.
//
// Returns one of:
//   { ok: true, count, matches, groupName }
//   { ok: false, status, reason: "skipped" | "invalid" | "error", message }
//
// The status code is the same one the HTTP handler would have returned.
const _runGenerateMatchesForGroup = async (tournament, group, opts = {}) => {
  const {
    courtNumber,
    startTime,
    slotDurationMinutes,
    matchDurationMinutes,
  } = opts;
  const tournamentId = tournament._id;

  let _generatedSportId;
  try {
    _generatedSportId = assertGroupHasSport(group);
  } catch (err) {
    return { ok: false, status: 400, reason: "invalid", message: err.message || "Group is missing sportId" };
  }

  if (group.players.length < 2) {
    return {
      ok: false, status: 400, reason: "invalid",
      message: "Group must have at least 2 players to generate matches.",
    };
  }

  const existingMatches = await Match.find({ tournamentId, groupId: group._id });
  if (existingMatches.length > 0) {
    return {
      ok: false, status: 400, reason: "skipped",
      message: `${existingMatches.length} matches already exist for this group.`,
      existingCount: existingMatches.length,
    };
  }

  // Resolve match format override: group-level takes priority
  const matchFormatOverride2 = (group.matchFormat && (group.matchFormat.totalSets || group.matchFormat.scoringType))
    ? group.matchFormat
    : null;

  // STEP 17b.iv — Determine match type from the groupStageFormat that applies
  // to THIS group's category. Resolving from the sport track alone gave every
  // category in a sport the same match type, so a Table Tennis track set to
  // "Doubles" generated doubles fixtures for Men's Singles, and a track set to
  // the combined "Singles, Doubles" failed the equality test below and
  // generated singles for every doubles category.
  const { getGroupStageFormat } = require("../utils/sportTrackUtils");
  const isDoubles =
    getGroupStageFormat(tournament, group?.sportId, group?.category) === "Doubles";
  const players = group.players;

  // Are the group's entrants ALREADY pairs?
  //
  // Doubles registration enters a pair as ONE entrant named "A & B" (see
  // utils/doublesPair), so a doubles group's player list holds one row per
  // pair and pairing it again below would put two pairs — four people — on one
  // side of a match.
  //
  // Older tournaments were built the other way round: each player entered
  // separately and this generator paired them, storing the second as
  // `partner`. Both shapes exist in the database, so detect rather than
  // assume — an entrant naming two people is already a pair.
  const { splitPair } = require("../utils/doublesPair");
  const entrantsArePairs = (players || []).some(
    (p) => splitPair(p?.userName).length > 1
  );
  const matchDocuments = [];
  let matchCount = 0;
  const baseTime = startTime ? new Date(startTime) : new Date();
  // Slot model: stride = slotDurationMinutes; play = matchDurationMinutes.
  // matchEndTime = matchStartTime + matchDurationMinutes; gap = slot − match.
  let _slot = parseInt(slotDurationMinutes, 10);
  let _match = parseInt(matchDurationMinutes, 10);
  if (!Number.isFinite(_slot) || _slot <= 0) _slot = 30;
  if (!Number.isFinite(_match) || _match <= 0) _match = _slot;
  if (_match > _slot) _match = _slot;
  const slotMs = _slot * 60000;
  const matchMs = _match * 60000;
  const groupId = group._id;

  // ── Court auto-assignment ──────────────────────────────────────────────
  // When the tournament has an active courts catalog (Sub-step 1 + 2), use it
  // to round-robin-assign courts and run per-court parallel time sequences.
  // When the catalog is empty (or no court applies to this sport), fall back
  // to the legacy single-court-number behavior — required for backward compat
  // on tournaments that haven't set up a catalog.
  //
  // Per-sport filter: in v1 every court has sportId === null (tournament-wide
  // pool), so the second clause is a no-op. v2 will populate sportId and the
  // filter will start mattering.
  const courtPool = (tournament.courts || [])
    .filter((c) => c.isActive !== false)
    .filter((c) => !c.sportId || String(c.sportId) === String(_generatedSportId))
    .map((c) => c.name);
  const useCourtPool = courtPool.length > 0;

  // computeSlot — given a 0-based match index, return { courtNumber, startTime, endTime }.
  // Algorithm with N courts: courtIdx = i % N, position = floor(i / N).
  // All N courts kick off at baseTime simultaneously; each runs its own
  // slot-spaced sequence after that. endTime = startTime + matchDurationMinutes.
  const computeSlot = (idx0) => {
    let startTime;
    let courtName;
    if (useCourtPool) {
      const N = courtPool.length;
      courtName = courtPool[idx0 % N];
      startTime = new Date(baseTime.getTime() + Math.floor(idx0 / N) * slotMs);
    } else {
      // Legacy fallback: single court, linear time. Identical to pre-Sub-step-3.
      courtName = courtNumber || "1";
      startTime = new Date(baseTime.getTime() + idx0 * slotMs);
    }
    const endTime = new Date(startTime.getTime() + matchMs);
    return { courtNumber: courtName, startTime, endTime };
  };

  // Legacy shape only: individuals were entered separately and get paired here.
  // Pre-paired entrants fall through to the round-robin below, which is the
  // correct fixture set for them — N pair-entrants play each other once.
  if (isDoubles && !entrantsArePairs) {
    if (players.length % 2 !== 0) {
      return {
        ok: false, status: 400, reason: "invalid",
        message: "Doubles format requires an even number of players in the group.",
      };
    }
    const pairs = [];
    for (let i = 0; i < players.length; i += 2) {
      pairs.push({ lead: players[i], partner: players[i + 1] });
    }
    for (let i = 0; i < pairs.length; i++) {
      for (let j = i + 1; j < pairs.length; j++) {
        matchCount++;
        const slot = computeSlot(matchCount - 1);
        const doc = createGroupStageMatch({
          tournament,
          tournamentId,
          sportId: _generatedSportId,
          groupId,
          matchNumber: `M${matchCount}`,
          player1: {
            playerId: pairs[i].lead.playerId,
            userName: pairs[i].lead.userName,
            partner: {
              playerId: pairs[i].partner.playerId,
              userName: pairs[i].partner.userName,
            },
          },
          player2: {
            playerId: pairs[j].lead.playerId,
            userName: pairs[j].lead.userName,
            partner: {
              playerId: pairs[j].partner.playerId,
              userName: pairs[j].partner.userName,
            },
          },
          courtNumber: slot.courtNumber,
          startTime: slot.startTime,
          matchEndTime: slot.endTime,
          matchFormatOverride: matchFormatOverride2,
        });
        doc.matchType = "doubles";
        matchDocuments.push(doc);
      }
    }
  } else {
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        matchCount++;
        const slot = computeSlot(matchCount - 1);
        const doc = createGroupStageMatch({
          tournament,
          tournamentId,
          sportId: _generatedSportId,
          groupId,
          matchNumber: `M${matchCount}`,
          player1: {
            playerId: players[i].playerId,
            userName: players[i].userName,
          },
          player2: {
            playerId: players[j].playerId,
            userName: players[j].userName,
          },
          courtNumber: slot.courtNumber,
          startTime: slot.startTime,
          matchEndTime: slot.endTime,
          matchFormatOverride: matchFormatOverride2,
        });
        // Each entrant may be a pair ("A & B") — the fixture is still one
        // round-robin meeting, but the match is a doubles match.
        doc.matchType = isDoubles ? "doubles" : "singles";
        matchDocuments.push(doc);
      }
    }
  }

  const createdMatches = await Match.insertMany(matchDocuments);

  // STEP 17b.iv — Update per-sport stage.
  const { getCurrentStage, setCurrentStage } = require("../utils/sportTrackUtils");
  const _stage = getCurrentStage(tournament, group?.sportId);
  if (_stage === "registration" || _stage === null) {
    await setCurrentStage(tournamentId, group?.sportId, "group_stage");
    if (!tournament.rulesLockedAt) {
      tournament.rulesLockedAt = new Date();
      await tournament.save({ validateModifiedOnly: true });
    }
  }

  return {
    ok: true,
    count: createdMatches.length,
    matches: createdMatches,
    groupName: group.groupName,
    totalPlayers: players.length,
  };
};

// HTTP handler — single group. Wraps the helper into the previous response shape.
const generateGroupMatches = async (req, res) => {
  try {
    const {
      tournamentId, groupId, courtNumber, startTime,
      slotDurationMinutes, matchDurationMinutes,
    } = req.body;

    if (!tournamentId || !groupId) {
      return res.status(400).json({
        success: false,
        message: "tournamentId and groupId are required.",
      });
    }

    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found." });
    }

    const group = await BookingGroup.findById(groupId);
    if (!group) {
      return res.status(404).json({ success: false, message: "Group not found." });
    }

    const result = await _runGenerateMatchesForGroup(tournament, group, {
      courtNumber, startTime,
      slotDurationMinutes, matchDurationMinutes,
    });

    if (!result.ok) {
      // Preserve the existing "already exist — delete first" message verbatim.
      const message = result.reason === "skipped"
        ? `${result.existingCount} matches already exist for this group. Delete them first to regenerate.`
        : result.message;
      return res.status(result.status).json({ success: false, message });
    }

    res.status(201).json({
      success: true,
      message: `${result.count} round-robin matches generated for group "${result.groupName}"`,
      totalPlayers: result.totalPlayers,
      totalMatches: result.count,
      matches: result.matches,
    });
  } catch (error) {
    console.error("[GENERATE_GROUP_MATCHES] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate group matches",
      error: error.message,
    });
  }
};

// HTTP handler — bulk generation across multiple groups in one shot.
// Body: { tournamentId, groupIds: [], courtNumber?, startTime?,
//         slotDurationMinutes?, matchDurationMinutes? }
// Returns 200 with a per-group breakdown so the UI can toast a summary
// (e.g. "Generated 18 matches across 5 groups; skipped 1 group").
const generateBulkGroupMatches = async (req, res) => {
  try {
    const {
      tournamentId, groupIds, courtNumber, startTime,
      slotDurationMinutes, matchDurationMinutes,
    } = req.body;

    if (!tournamentId || !Array.isArray(groupIds) || groupIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "tournamentId and a non-empty groupIds[] are required.",
      });
    }

    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found." });
    }

    const generated = [];
    const skipped = [];
    const failed = [];
    let totalMatchesCreated = 0;

    for (const gid of groupIds) {
      const group = await BookingGroup.findById(gid);
      if (!group) {
        failed.push({ groupId: gid, error: "Group not found" });
        continue;
      }

      const r = await _runGenerateMatchesForGroup(tournament, group, {
        courtNumber, startTime,
        slotDurationMinutes, matchDurationMinutes,
      });

      if (r.ok) {
        generated.push({ groupId: gid, groupName: r.groupName, count: r.count });
        totalMatchesCreated += r.count;
      } else if (r.reason === "skipped") {
        skipped.push({
          groupId: gid, groupName: group.groupName,
          reason: r.message, existingCount: r.existingCount,
        });
      } else {
        failed.push({ groupId: gid, groupName: group.groupName, error: r.message });
      }
    }

    res.status(200).json({
      success: true,
      message: `Generated ${totalMatchesCreated} match(es) across ${generated.length} group(s)` +
        (skipped.length ? `; skipped ${skipped.length}` : "") +
        (failed.length ? `; failed ${failed.length}` : ""),
      totalGroupsRequested: groupIds.length,
      totalMatchesCreated,
      generated,
      skipped,
      failed,
    });
  } catch (error) {
    console.error("[GENERATE_BULK_GROUP_MATCHES] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to bulk-generate group matches",
      error: error.message,
    });
  }
};

// Check if all group stage matches are done and transition to knockout
const transitionToKnockout = async (req, res) => {
  try {
    const { tournamentId, sportId } = req.body;

    if (!tournamentId) {
      return res.status(400).json({ success: false, message: "tournamentId is required." });
    }

    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found." });
    }

    // STEP 17b.i — per-sport gate. The transition is per-sport: each
    // sport must have both group stage and knockout phases configured.
    const { getTournamentType } = require("../utils/sportTrackUtils");
    const tournamentType = getTournamentType(tournament, sportId) || "";
    if (!tournamentType.includes("group stage") || !tournamentType.includes("knockout")) {
      return res.status(400).json({
        success: false,
        message: "This tournament does not have both group stage and knockout.",
      });
    }

    // Get all groups for this tournament
    const groups = await BookingGroup.find({ tournamentId });
    if (groups.length === 0) {
      return res.status(400).json({ success: false, message: "No groups found for this tournament." });
    }

    // Check all group matches are COMPLETED
    const allMatches = await Match.find({ tournamentId });
    if (allMatches.length === 0) {
      return res.status(400).json({ success: false, message: "No matches found. Generate group matches first." });
    }

    const pendingMatches = allMatches.filter((m) => m.status !== "COMPLETED");
    if (pendingMatches.length > 0) {
      return res.status(400).json({
        success: false,
        message: `${pendingMatches.length} match(es) still pending. Complete all group matches first.`,
        pendingCount: pendingMatches.length,
      });
    }

    // Get standings for each group and pick top N.
    // STEP 17b.iv — qualifyPerGroup read per-sport from track.
    // Now resolved PER GROUP, not once for the whole sport: a track can
    // advance the top 3 of Men's Doubles and the top 2 of Women's Singles.
    // BookingGroup.category is the only link to the category row, and
    // getQualifyPerGroup falls back to the track value when the category
    // sets none — so a tournament that configures nothing per category
    // behaves exactly as before.
    const GroupStandings = require("../src/modules/tournaments/models/GroupStandings");
    const { getQualifyPerGroup } = require("../utils/sportTrackUtils");
    const qualifiedPlayers = [];
    const qualifyByCategory = new Map();

    for (const group of groups) {
      // Prefer the group's own sportId: `groups` is not filtered by sport, so
      // in a multi-sport tournament resolving against the requested sportId
      // would read a category name against the wrong track.
      const qualifyPerGroup = getQualifyPerGroup(
        tournament,
        group.sportId || sportId,
        group.category
      );
      qualifyByCategory.set(group.category || "uncategorised", qualifyPerGroup);
      let standings = await GroupStandings.findOne({ tournamentId, groupId: group._id });

      // Recalculate if missing
      if (!standings) {
        const { recalculateGroupStandings } = require("./groupStageScoreboardController");
        standings = await recalculateGroupStandings(tournamentId, group._id);
      }

      if (!standings || !standings.standings.length) {
        return res.status(400).json({
          success: false,
          message: `No standings found for group "${group.groupName}". Complete matches first.`,
        });
      }

      // Pick top N by rank
      const topN = standings.standings
        .sort((a, b) => a.rank - b.rank)
        .slice(0, qualifyPerGroup);

      // Mark qualified in standings
      for (const player of standings.standings) {
        player.qualified = player.rank <= qualifyPerGroup;
      }
      standings.isFinalized = true;
      await standings.save({ validateModifiedOnly: true });

      for (const player of topN) {
        qualifiedPlayers.push({
          playerId: player.playerId,
          userName: player.playerName,
          fromGroup: group.groupName,
          rank: player.rank,
        });
      }
    }

    if (qualifiedPlayers.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Not enough qualified players to generate knockout bracket.",
      });
    }

    // STEP 17b.iv — advance per-sport stage via helper.
    const { setCurrentStage: _setStage } = require("../utils/sportTrackUtils");
    await _setStage(tournamentId, sportId, "knockout");

    // One cutoff for every category reads as before; a mixed configuration is
    // spelled out per category so the manager can see what was applied.
    const distinctCutoffs = [...new Set(qualifyByCategory.values())];
    const cutoffSummary =
      distinctCutoffs.length <= 1
        ? `top ${distinctCutoffs[0] ?? 2} per group`
        : [...qualifyByCategory.entries()]
            .map(([category, n]) => `${category}: top ${n}`)
            .join(", ");

    res.status(200).json({
      success: true,
      message: `${qualifiedPlayers.length} players qualified for knockout (${cutoffSummary}).`,
      currentStage: "knockout",
      qualifiedPlayers,
      qualifyPerGroupByCategory: Object.fromEntries(qualifyByCategory),
      nextStep: "Call POST /api/tournaments/direct-knockout/create-matches with these players to generate the bracket.",
    });
  } catch (error) {
    console.error("[TRANSITION_TO_KNOCKOUT] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to transition to knockout",
      error: error.message,
    });
  }
};

// Sub-step 5 — multi-collection court reassignment for ANY match doc.
// Tries each match collection in turn (Match → SuperMatch → DirectKnockoutMatch
// → KnockoutMatch → TeamKnockoutMatches). First hit wins. Mirrors the proven
// fallback pattern used by groupStageScoreboardController.getLiveMatchState.
//
// Validation is soft on purpose — the manager-facing UI (`<CourtPicker>`)
// only offers names from the catalog, but the endpoint itself accepts any
// non-empty trimmed string. Existing match docs already carry free-text
// strings, so server-side enforcement against tournament.courts would be
// over-strict and break legacy matches.
const updateMatchCourt = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { courtNumber } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({ success: false, message: "Invalid matchId" });
    }
    if (!courtNumber || !String(courtNumber).trim()) {
      return res.status(400).json({ success: false, message: "courtNumber is required" });
    }
    const trimmed = String(courtNumber).trim();

    // Lazy-require — the cycle of imports between controllers can produce
    // undefined references at module load time when match models are re-
    // imported across siblings. require() on demand avoids the issue.
    const SuperMatch = require("../src/modules/tournaments/models/SuperMatch");
    const DirectKnockoutMatch = require("../src/modules/tournaments/models/DirectKnockoutMatch");
    const KnockoutMatch = require("../src/modules/tournaments/models/KnockoutMatch");
    const TeamKnockoutMatches = require("../src/modules/tournaments/models/TeamKnockoutMatches");

    const collections = [
      { Model: Match,                label: "Match" },
      { Model: SuperMatch,           label: "SuperMatch" },
      { Model: DirectKnockoutMatch,  label: "DirectKnockoutMatch" },
      { Model: KnockoutMatch,        label: "KnockoutMatch" },
      { Model: TeamKnockoutMatches,  label: "TeamKnockoutMatches" },
    ];

    for (const { Model, label } of collections) {
      // findByIdAndUpdate returns null when not found — perfect for the
      // multi-collection cascade. validateModifiedOnly skips required:true
      // checks on unchanged paths (e.g. SuperMatch's required round enum).
      const updated = await Model.findByIdAndUpdate(
        matchId,
        { courtNumber: trimmed },
        { new: true, runValidators: false }
      );
      if (updated) {
        return res.status(200).json({
          success: true,
          message: `Court updated to "${trimmed}"`,
          match: updated,
          collection: label,
        });
      }
    }

    return res.status(404).json({
      success: false,
      message: "Match not found in any collection",
    });
  } catch (error) {
    console.error("[UPDATE_MATCH_COURT] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update match court",
      error: error.message,
    });
  }
};

module.exports = {
  createMatches,
  generateGroupMatches,
  generateBulkGroupMatches,
  transitionToKnockout,
  getMatchesByGroup,
  updateMatch,
  deleteMatch,
  deleteGroupMatches,
  updateMatchCourt,
};
