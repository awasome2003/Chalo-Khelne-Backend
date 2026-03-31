const mongoose = require("mongoose");
const Match = require("../Modal/Tournnamentmatch");
const Tournament = require("../Modal/Tournament");
const BookingGroup = require("../Modal/bookinggroup");
const Booking = require("../Modal/BookingModel");
const Referee = require("../Modal/Referee");
const { freezeMatchFormat } = require("../utils/matchFormatUtils");

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

    // Collect all valid playerIds from group
    const validPlayerIds = new Set(groupExists.players.map(p => p.playerId.toString()));

    // Resolve Match Format
    let detailedMatchFormat = {};

    if (groupExists.matchFormat && groupExists.matchFormat.totalSets) {
      // Use group-specific format
      detailedMatchFormat = {
        maxSets: groupExists.matchFormat.totalSets,
        setsToWin: groupExists.matchFormat.setsToWin || Math.ceil(groupExists.matchFormat.totalSets / 2),
        maxGames: groupExists.matchFormat.totalGames || 5,
        gamesToWin: groupExists.matchFormat.gamesToWin || 3,
        pointsToWinGame: groupExists.matchFormat.pointsToWinGame || 11,
        marginToWin: groupExists.matchFormat.marginToWin || 2,
        deuceRule: groupExists.matchFormat.deuceRule !== undefined ? groupExists.matchFormat.deuceRule : true
      };
    } else if (tournamentExists.matchFormat && tournamentExists.matchFormat.totalSets) {
      // Use tournament-level matchFormat (derived from sportRules at creation)
      const tf = tournamentExists.matchFormat;
      detailedMatchFormat = {
        maxSets: tf.totalSets,
        setsToWin: tf.setsToWin || Math.ceil(tf.totalSets / 2),
        maxGames: tf.totalGames || 5,
        gamesToWin: tf.gamesToWin || 3,
        pointsToWinGame: tf.pointsToWinGame || 11,
        marginToWin: tf.marginToWin || 2,
        maxPointsCap: tf.maxPointsCap || null,
        deuceRule: tf.deuceRule !== undefined ? tf.deuceRule : true
      };
    } else {
      // Last resort fallback to tournament setFormat
      const sets = parseInt(tournamentExists.setFormat) || 3;
      detailedMatchFormat = {
        maxSets: sets,
        setsToWin: Math.ceil(sets / 2),
        maxGames: 5,
        gamesToWin: 3,
        pointsToWinGame: 11,
        marginToWin: 2,
        deuceRule: true
      };
    }

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

      matchDocuments.push({
        tournamentId,
        groupId,
        matchNumber: matchNumber.toString(),
        player1,
        player2,
        referee: refereeData,
        courtNumber,
        startTime: new Date(startTime),
        matchFormat: detailedMatchFormat,
        status: "SCHEDULED"
      });
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

    const match = await Match.findById(matchId);
    if (!match) {
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

    const updatedMatch = await Match.findByIdAndUpdate(matchId, updates, { new: true });

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

// Auto-generate all round-robin matches for a group
const generateGroupMatches = async (req, res) => {
  try {
    const { tournamentId, groupId, courtNumber, startTime, intervalMinutes } = req.body;

    if (!tournamentId || !groupId) {
      return res.status(400).json({
        success: false,
        message: "tournamentId and groupId are required.",
      });
    }

    // Validate tournament and group
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found." });
    }

    const group = await BookingGroup.findById(groupId);
    if (!group) {
      return res.status(404).json({ success: false, message: "Group not found." });
    }

    if (group.players.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Group must have at least 2 players to generate matches.",
      });
    }

    // Check if matches already exist for this group
    const existingMatches = await Match.find({ tournamentId, groupId });
    if (existingMatches.length > 0) {
      return res.status(400).json({
        success: false,
        message: `${existingMatches.length} matches already exist for this group. Delete them first to regenerate.`,
      });
    }

    // Resolve match format (same logic as createMatches)
    let detailedMatchFormat = {};

    if (group.matchFormat && group.matchFormat.totalSets) {
      detailedMatchFormat = {
        maxSets: group.matchFormat.totalSets,
        setsToWin: group.matchFormat.setsToWin || Math.ceil(group.matchFormat.totalSets / 2),
        maxGames: group.matchFormat.totalGames || 5,
        gamesToWin: group.matchFormat.gamesToWin || 3,
        pointsToWinGame: group.matchFormat.pointsToWinGame || 11,
        marginToWin: group.matchFormat.marginToWin || 2,
        deuceRule: group.matchFormat.deuceRule !== undefined ? group.matchFormat.deuceRule : true,
      };
    } else if (tournament.matchFormat && tournament.matchFormat.totalSets) {
      const tf = tournament.matchFormat;
      detailedMatchFormat = {
        maxSets: tf.totalSets,
        setsToWin: tf.setsToWin || Math.ceil(tf.totalSets / 2),
        maxGames: tf.totalGames || 5,
        gamesToWin: tf.gamesToWin || 3,
        pointsToWinGame: tf.pointsToWinGame || 11,
        marginToWin: tf.marginToWin || 2,
        maxPointsCap: tf.maxPointsCap || null,
        deuceRule: tf.deuceRule !== undefined ? tf.deuceRule : true,
      };
    } else {
      const sets = parseInt(tournament.setFormat) || 3;
      detailedMatchFormat = {
        maxSets: sets,
        setsToWin: Math.ceil(sets / 2),
        maxGames: 5,
        gamesToWin: 3,
        pointsToWinGame: 11,
        marginToWin: 2,
        deuceRule: true,
      };
    }

    // Determine match type from tournament format
    const isDoubles = tournament.groupStageFormat === "Doubles";
    const players = group.players;
    const matchDocuments = [];
    let matchCount = 0;
    const baseTime = startTime ? new Date(startTime) : new Date();
    const interval = parseInt(intervalMinutes) || 30;

    if (isDoubles) {
      // Doubles: pair players sequentially (1+2 vs 3+4, 1+2 vs 5+6, etc.)
      // Players must be even count
      if (players.length % 2 !== 0) {
        return res.status(400).json({
          success: false,
          message: "Doubles format requires an even number of players in the group.",
        });
      }

      // Create pairs: [0,1], [2,3], [4,5], ...
      const pairs = [];
      for (let i = 0; i < players.length; i += 2) {
        pairs.push({ lead: players[i], partner: players[i + 1] });
      }

      // Round-robin between pairs
      for (let i = 0; i < pairs.length; i++) {
        for (let j = i + 1; j < pairs.length; j++) {
          matchCount++;
          matchDocuments.push({
            tournamentId,
            groupId,
            matchNumber: `M${matchCount}`,
            matchType: "doubles",
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
            courtNumber: courtNumber || "1",
            startTime: new Date(baseTime.getTime() + (matchCount - 1) * interval * 60000),
            matchFormat: detailedMatchFormat,
            status: "SCHEDULED",
          });
        }
      }
    } else {
      // Singles: standard round-robin n*(n-1)/2
      for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
          matchCount++;
          matchDocuments.push({
            tournamentId,
            groupId,
            matchNumber: `M${matchCount}`,
            matchType: "singles",
            player1: {
              playerId: players[i].playerId,
              userName: players[i].userName,
            },
            player2: {
              playerId: players[j].playerId,
              userName: players[j].userName,
            },
            courtNumber: courtNumber || "1",
            startTime: new Date(baseTime.getTime() + (matchCount - 1) * interval * 60000),
            matchFormat: detailedMatchFormat,
            status: "SCHEDULED",
          });
        }
      }
    }

    const createdMatches = await Match.insertMany(matchDocuments);

    // Update tournament stage + lock rules
    if (tournament.currentStage === "registration") {
      tournament.currentStage = "group_stage";
      if (!tournament.rulesLockedAt) tournament.rulesLockedAt = new Date();
      await tournament.save();
    }

    res.status(201).json({
      success: true,
      message: `${createdMatches.length} round-robin matches generated for group "${group.groupName}"`,
      totalPlayers: players.length,
      totalMatches: createdMatches.length,
      matches: createdMatches,
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

// Check if all group stage matches are done and transition to knockout
const transitionToKnockout = async (req, res) => {
  try {
    const { tournamentId } = req.body;

    if (!tournamentId) {
      return res.status(400).json({ success: false, message: "tournamentId is required." });
    }

    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found." });
    }

    // Must be a combined tournament
    if (!tournament.type.includes("group stage") || !tournament.type.includes("knockout")) {
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

    // Get standings for each group and pick top N
    const GroupStandings = require("../Modal/GroupStandings");
    const qualifyPerGroup = tournament.qualifyPerGroup || 2;
    const qualifiedPlayers = [];

    for (const group of groups) {
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
      await standings.save();

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

    // Update tournament stage
    tournament.currentStage = "knockout";
    await tournament.save();

    res.status(200).json({
      success: true,
      message: `${qualifiedPlayers.length} players qualified for knockout (top ${qualifyPerGroup} per group).`,
      currentStage: "knockout",
      qualifiedPlayers,
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

module.exports = {
  createMatches,
  generateGroupMatches,
  transitionToKnockout,
  getMatchesByGroup,
  updateMatch,
  deleteMatch,
};
