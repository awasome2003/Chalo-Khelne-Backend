const BookingGroup = require("../src/modules/tournaments/models/bookinggroup");
const Tournament = require("../src/modules/tournaments/models/Tournament");
const Booking = require("../src/modules/tournaments/models/BookingModel");
const { assertSportInTournament, handleSportContextError } = require("../middleware/requireSportContext");
const { pairDisplayName, normalizeName } = require("../utils/doublesPair");

exports.createBookingGroup = async (req, res) => {
  try {
    const { tournamentId, groupName, players, category, round, roundType } = req.body;

    // 1. Validate input
    if (!tournamentId || !groupName || !players || players.length === 0 || !category) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: tournamentId, groupName, category, or players",
      });
    }

    // 2. Check if tournament exists
    const tournamentExists = await Tournament.findById(tournamentId);
    if (!tournamentExists) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found",
      });
    }

    // 3. Build player docs — handle both Round 1 (booking IDs) and Round 2 (player objects)
    const playerDocs = [];
    const isRound2 = round === 2;

    if (isRound2) {
      // Round 2: players are already { playerId, userName } objects from Top Players
      for (const player of players) {
        playerDocs.push({
          playerId: player.playerId,
          userName: player.userName || player.playerName || "Player",
          bookingDate: player.bookingDate || new Date(),
          joinedAt: player.joinedAt || new Date(),
        });
      }
    } else {
      // Round 1: players are booking IDs — lookup from Booking collection
      for (let playerId of players) {
        const booking = await Booking.findById(playerId).populate("userId");
        if (!booking) {
          return res.status(404).json({
            success: false,
            message: `Booking with ID ${playerId} not found`,
          });
        }

        // Support guest bookings (userId is null) — use booking._id and userName
        const resolvedPlayerId = booking.userId?._id || booking._id;
        const baseName = booking.userId?.name || booking.userName || "Player";

        // Doubles: the entrant is the PAIR, so the row is named "A & B".
        //
        // The partner is stored per (booking, category) — one booking covers
        // several categories and the partner differs between them — so it is
        // read from the selection matching THIS group's category. A singles
        // category has no partner and pairDisplayName returns baseName
        // unchanged, which is exactly the previous behaviour.
        const selection = (booking.sportSelections || []).find(
          (s) => normalizeName(s.categoryName) === normalizeName(category)
        );
        const resolvedUserName = pairDisplayName(baseName, selection?.partnerName);

        playerDocs.push({
          playerId: resolvedPlayerId,
          userName: resolvedUserName,
          bookingDate: booking.bookingDate || null,
        });
      }
    }

    // STEP 16d — sportId is now required at the boundary. Manager UI
    // sends activeSportId. Validate against tournament.sports[] so the
    // group's sportId is always one this tournament actually owns.
    try {
      assertSportInTournament(req.body.sportId, tournamentExists);
    } catch (err) {
      if (handleSportContextError(err, res)) return;
      throw err;
    }

    const newGroup = new BookingGroup({
      tournamentId,
      sportId: req.body.sportId,
      groupName,
      category,
      players: playerDocs,
      round: round || 1,
      roundType: roundType || "group_stage",
    });

    await newGroup.save();

    return res.status(201).json({
      success: true,
      message: "Booking group created successfully",
      data: newGroup,
    });

  } catch (err) {
    console.error("Error creating booking group:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

exports.getBookingGroups = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { sportId } = req.query;

    // Multi-sport: when sportId is provided, also include docs where
    // sportId is null (per STEP 11a approval fix). Pre-migration groups
    // shouldn't disappear when the filter is active.
    const filter = sportId
      ? { tournamentId, $or: [{ sportId }, { sportId: null }] }
      : { tournamentId };
    const groups = await BookingGroup.find(filter)
      .populate("tournamentId", "title type")
      .populate({
        path: "players",
        populate: {
          path: "userId",
          select: "name profileImage",
        },
      });

    return res.status(200).json({
      success: true,
      data: groups,
    });
  } catch (err) {
    console.error("Error fetching booking groups:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

exports.updateBookingGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { groupName, players, category } = req.body;

    /* 1. Find group */
    const bookingGroup = await BookingGroup.findById(groupId);

    if (!bookingGroup) {
      return res.status(404).json({
        success: false,
        message: "Booking group not found"
      });
    }

    const tournamentId = bookingGroup.tournamentId;

    /* 2. Category validation */
    if (!category && !bookingGroup.category) {
      return res.status(400).json({
        success: false,
        message: "Category is required"
      });
    }

    /* 3. Players update — supports both user bookings and guest bookings */
    if (Array.isArray(players)) {
      const embeddedPlayers = [];

      for (const playerId of players) {
        // Try finding by userId first, then by booking _id (for guest bookings)
        let booking = await Booking.findOne({
          userId: playerId,
          tournamentId
        }).populate("userId", "name");

        if (!booking) {
          // Fallback: playerId might be a booking _id (guest booking)
          booking = await Booking.findById(playerId);
        }

        if (!booking) {
          return res.status(404).json({
            success: false,
            message: `Player with ID ${playerId} not found in bookings for this tournament`
          });
        }

        const resolvedPlayerId = booking.userId?._id || booking._id;
        const resolvedUserName = booking.userId?.name || booking.userName || "Player";

        embeddedPlayers.push({
          playerId: resolvedPlayerId,
          userName: resolvedUserName,
          bookingDate: booking.createdAt,
          joinedAt: new Date()
        });
      }

      bookingGroup.players = embeddedPlayers;
    }

    /* 4. Other updates */
    if (groupName) bookingGroup.groupName = groupName;
    if (category) bookingGroup.category = category;

    /* 5. Save */
    await bookingGroup.save({ validateModifiedOnly: true });

    return res.status(200).json({
      success: true,
      message: "Booking group updated successfully",
      data: bookingGroup
    });

  } catch (error) {
    console.error("Error updating booking group:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error"
    });
  }
};

// Internal helper — runs the single-group deletion with cascade + safety
// checks. Used by the single HTTP handler and the bulk handler.
//
// Returns one of:
//   { ok: true, deletedMatches, groupName }
//   { ok: false, status, reason: "notfound" | "blocked" | "error", message }
//
// 409 (blocked) condition: the per-sport currentStage has progressed past
// "group_stage" AND the group has at least one COMPLETED match. Prevents
// orphaning standings → top-players → knockout downstream chain.
async function _runDeleteBookingGroup(groupId) {
  const bookingGroup = await BookingGroup.findById(groupId);
  if (!bookingGroup) {
    return { ok: false, status: 404, reason: "notfound", message: "Booking group not found" };
  }

  const Match = require("../src/modules/tournaments/models/Tournnamentmatch");
  const completedCount = await Match.countDocuments({
    tournamentId: bookingGroup.tournamentId,
    groupId,
    status: "COMPLETED",
  });

  if (completedCount > 0) {
    const tournament = await Tournament.findById(bookingGroup.tournamentId);
    const { getCurrentStage } = require("../utils/sportTrackUtils");
    const stage = getCurrentStage(tournament, bookingGroup.sportId) || "registration";
    const blockedStages = ["knockout", "completed", "group_completed"];
    if (blockedStages.includes(stage)) {
      return {
        ok: false,
        status: 409,
        reason: "blocked",
        message: `"${bookingGroup.groupName}" has ${completedCount} completed match(es) and the tournament has progressed to ${stage}. Reset the knockout/round-2 stage for this sport before deleting the group.`,
        completedCount,
        stage,
        groupName: bookingGroup.groupName,
      };
    }
  }

  // Cascade-delete the group's matches.
  const matchesResult = await Match.deleteMany({
    tournamentId: bookingGroup.tournamentId,
    groupId,
  });

  await BookingGroup.findByIdAndDelete(groupId);

  return {
    ok: true,
    deletedMatches: matchesResult.deletedCount,
    groupName: bookingGroup.groupName,
  };
}

exports.deleteBookingGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const result = await _runDeleteBookingGroup(groupId);
    if (!result.ok) {
      return res.status(result.status).json({ success: false, message: result.message });
    }
    return res.status(200).json({
      success: true,
      message: `"${result.groupName}" deleted (${result.deletedMatches} match(es) also removed)`,
      deletedMatches: result.deletedMatches,
    });
  } catch (err) {
    console.error("Error deleting booking group:", err);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// Bulk delete — body: { groupIds: [] }. Aggregates per-group outcomes so the
// UI can summarize: "Deleted 3 groups (12 matches); blocked 1 (already in
// knockout)".
exports.deleteBulkBookingGroups = async (req, res) => {
  try {
    const { groupIds } = req.body;
    if (!Array.isArray(groupIds) || groupIds.length === 0) {
      return res.status(400).json({ success: false, message: "groupIds[] is required" });
    }

    const deleted = [];
    const blocked = [];
    const failed = [];
    let totalMatchesRemoved = 0;

    for (const gid of groupIds) {
      const r = await _runDeleteBookingGroup(gid);
      if (r.ok) {
        deleted.push({ groupId: gid, groupName: r.groupName, matchesAlsoDeleted: r.deletedMatches });
        totalMatchesRemoved += r.deletedMatches;
      } else if (r.reason === "blocked") {
        blocked.push({ groupId: gid, groupName: r.groupName, message: r.message, completedCount: r.completedCount, stage: r.stage });
      } else {
        failed.push({ groupId: gid, error: r.message });
      }
    }

    res.status(200).json({
      success: true,
      message: `Deleted ${deleted.length} group(s) and ${totalMatchesRemoved} match(es)` +
        (blocked.length ? `; blocked ${blocked.length}` : "") +
        (failed.length ? `; failed ${failed.length}` : ""),
      totalGroupsRequested: groupIds.length,
      totalMatchesRemoved,
      deleted,
      blocked,
      failed,
    });
  } catch (err) {
    console.error("[DELETE_BULK_BOOKING_GROUPS] Error:", err);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// 🚀 Get group-specific match format
exports.getGroupMatchFormat = async (req, res) => {
  try {
    const { groupId } = req.params;
    const group = await BookingGroup.findById(groupId).select("matchFormat");

    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found",
      });
    }

    return res.status(200).json({
      success: true,
      matchFormat: group.matchFormat,
    });
  } catch (err) {
    console.error("Error fetching group match format:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

// 🚀 Update group-specific match format
exports.updateGroupMatchFormat = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { matchFormat } = req.body;

    if (!matchFormat) {
      return res.status(400).json({
        success: false,
        message: "Match format data is required",
      });
    }

    const group = await BookingGroup.findByIdAndUpdate(
      groupId,
      { matchFormat },
      { new: true }
    );

    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Group match format updated successfully",
      data: group.matchFormat,
    });
  } catch (err) {
    console.error("Error updating group match format:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

