const Tournament = require("../Modal/Tournament");
const Booking = require("../Modal/BookingModel");
const BookingGroup = require("../Modal/bookinggroup");
const Score = require("../Modal/Score");
const Match = require("../Modal/Tournnamentmatch");
const KnockoutMatch = require("../Modal/KnockoutMatch");
const SuperMatch = require("../Modal/SuperMatch");
const DirectKnockoutMatch = require("../Modal/DirectKnockoutMatch");
const User = require("../Modal/User");
const SportRuleBook = require("../Modal/SportRuleBook");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const Turf = require('../Modal/Turf')
const { uploadsDir } = require("../middleware/uploads");
const notificationController = require("./notificationController");
const TopPlayers = require("../Modal/TopPlayers");
const SuperPlayers = require("../Modal/SuperPlayers");
const Sport = require("../Modal/Sport");
const { sanitizeMatchFormat, validateMatchFormat: validateSportMatchFormat } = require("../utils/sportFieldConfig");

// ===================== ROUND 2 PROGRESSION SYSTEM =====================

// Check Round 2 Status
exports.getRound2Status = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    // Check tournament stage
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }

    // Check if Round 2 has been initiated
    const round2Groups = await BookingGroup.find({
      tournamentId,
      round: 2
    });

    if (round2Groups.length > 0) {
      return res.json({
        success: true,
        status: {
          option: 'group_stage',
          status: 'initiated',
          groupsCount: round2Groups.length
        }
      });
    }

    // Check if knockout has been initiated (you can extend this based on your knockout system)
    if (tournament.currentStage === 'qualifier_knockout') {
      return res.json({
        success: true,
        status: {
          option: 'knockout',
          status: 'initiated'
        }
      });
    }

    // No Round 2 initiated yet
    return res.json({
      success: false,
      message: "Round 2 not initiated yet"
    });

  } catch (error) {
    console.error("Error checking Round 2 status:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

// Initiate Round 2
exports.initiateRound2 = async (req, res) => {
  try {
    const { tournamentId, option, topPlayers } = req.body;

    // Validate input
    if (!tournamentId || !option || !topPlayers || topPlayers.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Invalid input. Need at least 2 top players."
      });
    }

    // Validate tournament exists
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }

    if (option === 'knockout') {
      // Update tournament stage to qualifier knockout (only update the stage fields)
      await Tournament.findByIdAndUpdate(tournamentId, {
        currentStage: 'qualifier_knockout',
        'stageConfig.qualifierKnockout.enabled': true
      });

      // Here you can add knockout bracket generation logic
      // For now, we'll just mark it as initiated

      return res.json({
        success: true,
        message: "Round 2 Knockout initiated successfully",
        data: { option: 'knockout', status: 'initiated' }
      });

    } else if (option === 'group_stage') {
      // Mark for Round 2 Group Stage (only update the stage fields)
      await Tournament.findByIdAndUpdate(tournamentId, {
        currentStage: 'qualifier_knockout',
        'stageConfig.qualifierKnockout.enabled': true
      });

      return res.json({
        success: true,
        message: "Ready for Round 2 Group Stage creation",
        data: { option: 'group_stage', status: 'initiated' }
      });
    }

    return res.status(400).json({
      success: false,
      message: "Invalid option. Must be 'knockout' or 'group_stage'"
    });

  } catch (error) {
    console.error("Error initiating Round 2:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

// Create Round 2 Groups
exports.createRound2Groups = async (req, res) => {
  try {
    const { tournamentId, groups, topPlayers } = req.body;

    // Validate input
    if (!tournamentId || !groups || !topPlayers) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields"
      });
    }

    // Validate tournament exists
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }

    const createdGroups = [];

    // Create Round 2 groups
    for (let groupConfig of groups) {
      const { groupName, players } = groupConfig;

      // Convert top players data to booking group format
      const groupPlayers = players.map(player => ({
        playerId: player.playerId,
        userName: player.playerName,
        bookingDate: new Date(),
        joinedAt: new Date()
      }));

      const round2Group = new BookingGroup({
        tournamentId,
        groupName,
        category: players[0]?.category || 'Open',
        players: groupPlayers,
        round: 2, // Mark as Round 2
        roundType: 'qualifier',
        status: 'active'
      });

      await round2Group.save();
      createdGroups.push(round2Group);
    }

    // Update tournament stage (only the fields we need)
    await Tournament.findByIdAndUpdate(tournamentId, {
      currentStage: 'qualifier_knockout',
      'stageConfig.qualifierKnockout.enabled': true
    });

    return res.json({
      success: true,
      message: "Round 2 groups created successfully",
      groups: createdGroups
    });

  } catch (error) {
    console.error("Error creating Round 2 groups:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

// Get Round 2 Groups
exports.getRound2Groups = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    const round2Groups = await BookingGroup.find({
      tournamentId,
      round: 2
    }).populate({
      path: "players.playerId",
      select: "name profileImage"
    });

    return res.json({
      success: true,
      groups: round2Groups
    });

  } catch (error) {
    console.error("Error fetching Round 2 groups:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

// Identify Super Players (winners of Round 2)
exports.identifySuperPlayers = async (req, res) => {
  try {
    const { tournamentId } = req.body;

    // Find all Round 2 groups
    const round2Groups = await BookingGroup.find({
      tournamentId,
      round: 2,
      status: 'completed' // Only from completed Round 2 groups
    });

    if (round2Groups.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No completed Round 2 groups found"
      });
    }

    const superPlayers = [];

    // For each Round 2 group, find the winner
    // This is a simplified version - you'd want to integrate with your points system
    for (let group of round2Groups) {
      // In a real implementation, you'd calculate the group winner from match results
      // For now, we'll take the first player as a placeholder
      if (group.players && group.players.length > 0) {
        const winner = group.players[0]; // Placeholder logic

        superPlayers.push({
          playerId: winner.playerId,
          playerName: winner.userName,
          category: group.category,
          sourceGroupId: group._id,
          sourceRound: 2,
          status: 'super_player'
        });
      }
    }

    // Save Super Players to TopPlayers collection
    const superPlayersDoc = new TopPlayers({
      tournamentId,
      groupId: 'round2_super_players',
      groupName: 'Super Players',
      players: superPlayers,
      round: 2,
      roundType: 'super_players'
    });

    await superPlayersDoc.save();

    // Update tournament stage (only the fields we need)
    await Tournament.findByIdAndUpdate(tournamentId, {
      currentStage: 'main_knockout',
      'stageConfig.qualifierKnockout.completed': true,
      'stageConfig.mainKnockout.enabled': true
    });

    return res.json({
      success: true,
      message: "Super Players identified successfully",
      superPlayers: superPlayers
    });

  } catch (error) {
    console.error("Error identifying Super Players:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

// Get Super Players
exports.getSuperPlayers = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    const superPlayersDoc = await SuperPlayers.findOne({
      tournamentId
    }).populate('players.playerId', 'name profileImage');

    if (!superPlayersDoc) {
      return res.json({
        success: true,
        superPlayers: []
      });
    }

    return res.json({
      success: true,
      superPlayers: superPlayersDoc.players
    });

  } catch (error) {
    console.error("Error fetching Super Players:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

// Reset Round 2 Progress
exports.resetRound2Progress = async (req, res) => {
  try {
    const { tournamentId } = req.body;

    // Reset tournament stage back to group_stage
    await Tournament.findByIdAndUpdate(tournamentId, {
      currentStage: 'group_stage',
      'stageConfig.qualifierKnockout.enabled': false,
      'stageConfig.qualifierKnockout.completed': false
    });

    // Delete any Round 2 groups
    await BookingGroup.deleteMany({
      tournamentId,
      round: 2
    });

    // Delete any Round 2 TopPlayers records
    await TopPlayers.deleteMany({
      tournamentId,
      round: 2
    });

    return res.json({
      success: true,
      message: "Round 2 progress has been reset successfully"
    });

  } catch (error) {
    console.error("Error resetting Round 2 progress:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

//*Create Tournament*//

exports.createTournament = async (req, res) => {
  try {
    const {
      title,
      type,
      sportsType,
      description,
      selectedTime,
      startDate,
      endDate,
      organizerName,
      cancellationPolicy,
      managerId,
      category,
      termsAndConditions,
      eventLocation, // ✅ simple string from frontend
      numTeams,
      playerNoValue,
      setNo,
      tournamentFee,
      setsFormat,
      groupStageFormat,
      knockoutFormat,
      qualifyPerGroup,
      matchFormatOverrides, // Dynamic match format from sport-driven form
      turfIds, // For backward compatibility
      tournamentLevel, // district, state, national, international
    } = req.body;

    // --- Basic validation ---
    if (!title || !type || !sportsType) {
      return res.status(400).json({ message: "Title, Type, and Sports Type are required." });
    }

    // --- Validation for per-stage play formats ---
    if (type && type.includes("group stage") && !groupStageFormat) {
      return res.status(400).json({ message: "Group Stage Format is required for group stage tournaments." });
    }
    if (type && type.includes("knockout") && !knockoutFormat) {
      return res.status(400).json({ message: "Knockout Format is required for knockout tournaments." });
    }

    // --- Parse turfIds (for backward compatibility) ---
    let parsedTurfIds = [];
    if (turfIds) {
      try {
        parsedTurfIds = JSON.parse(turfIds);
        if (!Array.isArray(parsedTurfIds)) {
          throw new Error();
        }
      } catch {
        // Not critical since eventLocation is now a simple string
        parsedTurfIds = [];
      }
    }

    // --- Parse managerId ---
    let parsedManagerId = [];
    if (managerId) {
      try {
        parsedManagerId = JSON.parse(managerId);
        if (!Array.isArray(parsedManagerId)) throw new Error();
      } catch {
        return res.status(400).json({ message: "Invalid managerId format" });
      }
    }

    // --- Parse category ---
    let parsedCategory = [];
    if (category) {
      try {
        parsedCategory = JSON.parse(category);
        if (!Array.isArray(parsedCategory)) throw new Error();
      } catch {
        return res.status(400).json({ message: "Invalid category format" });
      }
    } else {
      parsedCategory = [{ name: "Open Category", fee: 0 }];
    }

    // --- Parse selectedTime ---
    let parsedSelectedTime = null;
    if (selectedTime) {
      try {
        parsedSelectedTime = JSON.parse(selectedTime);
      } catch {
        return res.status(400).json({ message: "Invalid selectedTime format" });
      }
    }

    // --- Auto-attach locked sport rules from rule book ---
    let sportRulesData = null;
    const level = tournamentLevel || "district";

    if (sportsType) {
      try {
        const ruleBook = await SportRuleBook.findOne({
          sportName: { $regex: new RegExp(`^${sportsType}$`, "i") },
          level: level,
        }).lean();

        if (ruleBook) {
          sportRulesData = {
            ruleBookId: ruleBook._id,
            sportName: ruleBook.sportName,
            level: ruleBook.level,
            format: ruleBook.format,
            rules: ruleBook.rules,
            equipment: ruleBook.equipment,
            isLocked: true,
          };
        }
      } catch (ruleErr) {
        console.log("Rule book lookup skipped:", ruleErr.message);
      }
    }

    // --- Parse & validate dynamic matchFormatOverrides ---
    let parsedMatchFormatOverrides = null;
    if (matchFormatOverrides) {
      try {
        parsedMatchFormatOverrides = typeof matchFormatOverrides === "string"
          ? JSON.parse(matchFormatOverrides)
          : matchFormatOverrides;
      } catch {
        return res.status(400).json({ message: "Invalid matchFormatOverrides format" });
      }

      // Flatten nested sport-specific format structures into flat keys
      // The frontend ruleBook engine sends nested objects like { format: { oversCount: 20 }, scoring: {...} }
      // but the validator expects flat keys like { oversCount: 20 }
      const flattenOverrides = (obj) => {
        const flat = {};
        for (const [key, val] of Object.entries(obj)) {
          if (val && typeof val === "object" && !Array.isArray(val)) {
            // Recurse into nested objects, pull up known matchFormat keys
            const nested = flattenOverrides(val);
            Object.assign(flat, nested);
          } else {
            flat[key] = val;
          }
        }
        return flat;
      };
      parsedMatchFormatOverrides = flattenOverrides(parsedMatchFormatOverrides);

      // Backend safety: validate + sanitize against sport config
      if (sportsType) {
        const sportDoc = await Sport.findOne({
          name: { $regex: new RegExp(`^${sportsType}$`, "i") },
          isActive: true,
        }).lean();

        if (sportDoc) {
          const { valid, errors } = validateSportMatchFormat(parsedMatchFormatOverrides, sportDoc);
          if (!valid) {
            return res.status(400).json({
              message: "Match format validation failed",
              errors,
            });
          }
          // Strip any extra fields not relevant to this sport
          parsedMatchFormatOverrides = sanitizeMatchFormat(parsedMatchFormatOverrides, sportDoc);
        }
      }
    }

    // --- Build tournament object ---
    const tournamentData = {
      title,
      type,
      sportsType,
      tournamentLevel: level,
      sportRules: sportRulesData,
      description: description || "",
      selectedTime: parsedSelectedTime,
      startDate,
      endDate,
      organizerName,
      cancellationPolicy,
      eventLocation: eventLocation || "",
      managerId: parsedManagerId,
      category: parsedCategory,
      termsAndConditions: termsAndConditions || "",
      numTeams: numTeams || 0,
      playerNoValue: playerNoValue || "2",
      tournamentFee: tournamentFee || "0",
      // Derive matchFormat: prefer dynamic overrides > locked sportRules > hardcoded defaults
      matchFormat: (() => {
        const rf = sportRulesData?.format || {};
        const ov = parsedMatchFormatOverrides || {};
        // Dynamic overrides take priority, then sportRules, then defaults
        const totalSets = ov.totalSets || rf.totalSets || 3;
        return {
          totalSets,
          setsToWin: Math.ceil(totalSets / 2),
          totalGames: ov.gamesPerSet || rf.gamesPerSet || 5,
          gamesToWin: ov.gamesPerSet ? Math.ceil((ov.gamesPerSet || rf.gamesPerSet) / 2) : rf.gamesPerSet ? Math.ceil(rf.gamesPerSet / 2) : 3,
          pointsToWinGame: ov.pointsPerGame || ov.pointsPerSet || rf.pointsPerGame || rf.pointsPerSet || 11,
          marginToWin: ov.winByMargin != null ? ov.winByMargin : (rf.winByMargin != null ? rf.winByMargin : 2),
          maxPointsCap: ov.maxPointsCap || rf.maxPointsCap || null,
          deuceRule: ov.deuceEnabled != null ? ov.deuceEnabled : (rf.deuceEnabled != null ? rf.deuceEnabled : true),
          // Pass through sport-specific fields for non-sets sports
          ...(ov.oversCount != null && { oversCount: ov.oversCount }),
          ...(ov.inningsCount != null && { inningsCount: ov.inningsCount }),
          ...(ov.halvesCount != null && { halvesCount: ov.halvesCount }),
          ...(ov.halvesDuration != null && { halvesDuration: ov.halvesDuration }),
          ...(ov.quartersCount != null && { quartersCount: ov.quartersCount }),
          ...(ov.quartersDuration != null && { quartersDuration: ov.quartersDuration }),
          ...(ov.tiebreakEnabled != null && { tiebreakEnabled: ov.tiebreakEnabled }),
          ...(ov.tiebreakPoints != null && { tiebreakPoints: ov.tiebreakPoints }),
          ...(ov.decidingSetPoints != null && { decidingSetPoints: ov.decidingSetPoints }),
          ...(ov.serviceRules != null && { serviceRules: ov.serviceRules }),
        };
      })(),
      setFormat: parsedMatchFormatOverrides?.totalSets || (sportRulesData?.format?.totalSets) || 3,
      groupStageFormat: type.includes("group stage") ? groupStageFormat : undefined,
      knockoutFormat: type.includes("knockout") ? knockoutFormat : undefined,
      qualifyPerGroup: qualifyPerGroup ? parseInt(qualifyPerGroup) : 2,
    };

    // --- Handle tournament logo upload ---
    if (req.file) {
      const uploadsDirPath = path.join(__dirname, "../uploads/tournaments");
      const relativePath = path.relative(uploadsDirPath, req.file.path);
      tournamentData.tournamentLogo = relativePath;
    }

    // --- Save tournament ---
    const newTournament = new Tournament(tournamentData);
    await newTournament.save();

    res.status(201).json({
      message: "Tournament created successfully",
      tournament: newTournament,
    });
  } catch (error) {
    console.error("Error creating tournament:", error);

    // --- Cleanup uploaded file if error ---
    if (req.file) {
      try {
        await fs.promises.unlink(req.file.path);
      } catch (cleanupErr) {
        console.error("Error deleting uploaded file:", cleanupErr);
      }
    }

    res.status(500).json({
      message: "Failed to create tournament",
      error: error.message,
    });
  }
};


exports.getTournamentById = async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.id);
    if (!tournament) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found",
      });
    }

    res.json({
      success: true,
      tournament,
    });
  } catch (error) {
    console.error("Error fetching tournament:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch tournament details",
    });
  }
};

exports.getTournamentsByManager = async (req, res) => {
  try {
    const managerId = req.params.managerId;

    // Validate manager ID format
    if (!mongoose.Types.ObjectId.isValid(managerId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid manager ID format",
      });
    }

    // 1. Get the manager to find their parent clubId
    const { Manager } = require("../Modal/ClubManager");
    const manager = await Manager.findById(managerId);

    const searchIds = [new mongoose.Types.ObjectId(managerId)];

    // If this manager belongs to a parent (Corporate Admin or Club Admin), 
    // also fetch tournaments created by that parent.
    if (manager && manager.clubId) {
      searchIds.push(new mongoose.Types.ObjectId(manager.clubId));
    }

    // 2. Find tournaments where managerId array contains either the manager's ID or their parent's ID
    const tournaments = await Tournament.find({
      managerId: { $in: searchIds },
    }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      tournaments,
      count: tournaments.length,
    });
  } catch (error) {
    console.error("Error fetching tournaments by manager:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch tournaments",
    });
  }
};

exports.updateTournamentWhitelist = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { whitelist } = req.body;

    if (!Array.isArray(whitelist)) {
      return res.status(400).json({ success: false, message: "Whitelist must be an array" });
    }

    // Backend Unique Validation
    const uniqueIds = new Set();
    const uniqueMobiles = new Set();
    const validatedWhitelist = [];

    for (const emp of whitelist) {
      const { employeeId, mobile } = emp;

      // Basic check: if both ID and mobile are provided, check both. 
      // If only one is provided, check that one.
      const idKey = employeeId ? employeeId.toString().trim() : null;
      const mobileKey = mobile ? mobile.toString().trim() : null;

      if (idKey && uniqueIds.has(idKey)) {
        return res.status(400).json({ success: false, message: `Duplicate Employee ID found in list: ${idKey}` });
      }
      if (mobileKey && uniqueMobiles.has(mobileKey)) {
        return res.status(400).json({ success: false, message: `Duplicate Mobile number found in list: ${mobileKey}` });
      }

      if (idKey) uniqueIds.add(idKey);
      if (mobileKey) uniqueMobiles.add(mobileKey);

      validatedWhitelist.push(emp);
    }

    const Tournament = require("../Modal/Tournament");
    const tournament = await Tournament.findByIdAndUpdate(
      tournamentId,
      { whitelist: validatedWhitelist },
      { new: true }
    );

    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found" });
    }

    res.status(200).json({
      success: true,
      message: "Employee whitelist updated successfully",
      tournament
    });
  } catch (error) {
    console.error("Error updating whitelist:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update whitelist"
    });
  }
};

exports.getTournamentsByCorporate = async (req, res) => {
  try {
    const { corporateId } = req.params;

    // 1. Find all managers belonging to this Corporate Admin
    const { Manager } = require("../Modal/ClubManager");
    const managers = await Manager.find({ clubId: corporateId });

    // Extract manager IDs
    const searchIds = managers.map(m => m._id);

    // 2. Add the corporateId itself to include tournaments created by the Corporate Admin
    if (mongoose.Types.ObjectId.isValid(corporateId)) {
      searchIds.push(new mongoose.Types.ObjectId(corporateId));
    }

    // 3. Find tournaments created by these managers or the corporate admin themselves
    const tournaments = await Tournament.find({
      managerId: { $in: searchIds }
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      tournaments
    });

  } catch (error) {
    console.error("Error fetching corporate tournaments:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch corporate tournaments"
    });
  }
};

exports.getAllTournaments = async (req, res) => {
  try {
    const tournaments = await Tournament.find();

    res.status(200).json(tournaments);
  } catch (error) {
    console.error("Error fetching tournaments:", error);

    // Log the error details
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      message: "Failed to retrieve tournaments",
      error: error.message,
    });
  }
};

exports.deleteTournament = async (req, res) => {
  try {
    const { id } = req.params;

    // Delete the tournament
    const tournament = await Tournament.findByIdAndDelete(id);
    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    // Delete all bookings related to this tournament
    await Booking.deleteMany({ tournamentId: id });

    // Delete all booking groups related to this tournament
    await BookingGroup.deleteMany({ tournamentId: id });

    // Add other deletions here if needed (e.g., matches, scores, etc.)

    res
      .status(200)
      .json({
        message: "Tournament and all related data deleted successfully",
      });
  } catch (error) {
    console.error("Error deleting tournament and related data:", error);
    res.status(500).json({
      message: "Failed to delete tournament and related data",
      error: error.message,
    });
  }
};

exports.editTournament = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if tournament exists
    const tournament = await Tournament.findById(id);
    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    // Parse selectedTime
    let parsedSelectedTime = tournament.selectedTime;
    if (req.body.selectedTime) {
      try {
        parsedSelectedTime = JSON.parse(req.body.selectedTime);
        if (
          typeof parsedSelectedTime !== "object" ||
          !parsedSelectedTime.startTime ||
          !parsedSelectedTime.endTime
        ) {
          return res.status(400).json({ message: "Invalid selectedTime format" });
        }
      } catch (err) {
        return res.status(400).json({ message: "Invalid selectedTime format" });
      }
    }

    // Parse category
    let categories = tournament.category;
    if (req.body.category) {
      try {
        categories = JSON.parse(req.body.category);
        if (!Array.isArray(categories)) {
          return res.status(400).json({ message: "Invalid category format" });
        }
      } catch (err) {
        return res.status(400).json({ message: "Invalid category format" });
      }
    }

    // Parse terms and conditions
    let termsAndConditions = req.body.termsAndConditions || tournament.termsAndConditions;

    // Parse managerId
    let managerIds = tournament.managerId;
    if (req.body.managerId) {
      try {
        managerIds = JSON.parse(req.body.managerId);
        if (!Array.isArray(managerIds)) {
          return res.status(400).json({ message: "Invalid managerId format" });
        }
      } catch (err) {
        return res.status(400).json({ message: "Invalid managerId format" });
      }
    }

    // Handle logo upload
    if (req.file) {
      const uploadsDir = path.join(__dirname, "../uploads/tournaments");
      const relativePath = path.relative(uploadsDir, req.file.path);
      tournament.tournamentLogo = relativePath;
    }

    // Update fields
    tournament.title = req.body.title || tournament.title;
    tournament.type = req.body.type || tournament.type;
    tournament.sportsType = req.body.sportsType || tournament.sportsType;
    tournament.description = req.body.description || tournament.description;
    tournament.selectedTime = parsedSelectedTime;
    tournament.startDate = req.body.startDate || tournament.startDate;
    tournament.endDate = req.body.endDate || tournament.endDate;
    tournament.organizerName = req.body.organizerName || tournament.organizerName;
    tournament.cancellationPolicy = req.body.cancellationPolicy || tournament.cancellationPolicy;
    tournament.eventLocation = req.body.eventLocation || tournament.eventLocation;
    tournament.managerId = managerIds;
    tournament.category = categories;
    tournament.termsAndConditions = termsAndConditions;

    // 🎯 NEW FIELDS FOR FULL EDIT FUNCTIONALITY
    if (req.body.groupStageFormat) tournament.groupStageFormat = req.body.groupStageFormat;
    if (req.body.knockoutFormat) tournament.knockoutFormat = req.body.knockoutFormat;
    if (req.body.qualifyPerGroup) tournament.qualifyPerGroup = parseInt(req.body.qualifyPerGroup);
    tournament.numTeams = req.body.numTeams || tournament.numTeams;
    tournament.playerNoValue = req.body.playerNoValue || tournament.playerNoValue;
    tournament.setNo = req.body.setNo || tournament.setNo;
    tournament.tournamentFee = req.body.tournamentFee || tournament.tournamentFee;

    // Handle setFormat update (mapping from setsFormat string)
    if (req.body.setsFormat) {
      tournament.setFormat =
        req.body.setsFormat === 'bestOf3' ? 3 :
          req.body.setsFormat === 'bestOf5' ? 5 :
            req.body.setsFormat === 'bestOf7' ? 7 :
              tournament.setFormat;

      // Also update default matchFormat if setFormat changed
      if (!tournament.matchFormat) tournament.matchFormat = {};
      tournament.matchFormat.totalSets = tournament.setFormat;
      tournament.matchFormat.setsToWin = Math.ceil(tournament.setFormat / 2);
    }

    await tournament.save();

    res.status(200).json({
      message: "Tournament updated successfully",
      tournament,
    });
  } catch (error) {
    console.error("Error updating tournament:", error);
    if (req.file) {
      try {
        await fs.promises.unlink(req.file.path);
      } catch (unlinkErr) {
        console.error("Error removing uploaded file after failure:", unlinkErr);
      }
    }
    res.status(500).json({
      message: "Failed to update tournament",
      error: error.message,
    });
  }
};



exports.createScore = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { playerA, playerB, setOne, setTwo, setThree } = req.body;

    if (!playerA || !playerB || !setOne) {
      return res.status(400).json({
        message: "Missing required fields",
        received: { playerA, playerB, setOne, setTwo, setThree },
      });
    }

    const match = await Match.findById(matchId);
    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    const playerIdsInMatch = [
      match.player1.toString(),
      match.player2.toString(),
    ];

    if (!playerIdsInMatch.includes(playerA) || !playerIdsInMatch.includes(playerB)) {
      return res.status(400).json({
        message: "Players must belong to the match",
        validPlayers: playerIdsInMatch,
      });
    }

    // ✅ Helper: validate a set (≥11 points & 2-point lead)
    const isValidSet = (score) => {
      if (!score || typeof score !== "string" || !score.includes("-")) return false;
      const [a, b] = score.split("-").map(Number);
      if (isNaN(a) || isNaN(b)) return false;
      return (a >= 11 || b >= 11) && Math.abs(a - b) >= 2;
    };

    // ✅ Collect sets that exist
    const sets = [setOne, setTwo, setThree].filter(Boolean);

    // Validate each set
    if (!sets.every(isValidSet)) {
      return res.status(400).json({ message: "Invalid set scores. Each set must have ≥11 points and a 2-point lead." });
    }

    // ✅ Count set wins
    let playerAWins = 0, playerBWins = 0;
    sets.forEach((set) => {
      const [a, b] = set.split("-").map(Number);
      if (a > b) playerAWins++;
      if (b > a) playerBWins++;
    });

    // ✅ Derive winner from set wins
    let winner = null;
    if (playerAWins > playerBWins) {
      winner = playerA;
    } else if (playerBWins > playerAWins) {
      winner = playerB;
    }

    if (!winner) {
      return res.status(400).json({ message: "Could not determine a winner from set results" });
    }

    const newScore = new Score({
      matchId,
      playerA,
      playerB,
      setOne,
      setTwo: setTwo || null,
      setThree: setThree || null,
      winner,
    });

    await newScore.save();

    res.status(201).json({
      message: "Score saved successfully",
      newScore,
    });
  } catch (error) {
    console.error("Error creating score:", error);
    res.status(500).json({
      message: "Failed to save score",
      error: error.message,
    });
  }
};

exports.getScoreByMatchId = async (req, res) => {
  try {
    const { matchId } = req.params;

    const score = await Score.findOne({ matchId })
      .populate({
        path: 'playerA',
        populate: {
          path: 'userId',
          select: 'name profileImage',
        },
      })
      .populate({
        path: 'playerB',
        populate: {
          path: 'userId',
          select: 'name profileImage',
        },
      })
      .populate({
        path: 'winner',
        populate: {
          path: 'userId',
          select: 'name profileImage',
        },
      });

    if (!score) {
      return res.status(404).json({ message: "Score not found for this match" });
    }

    res.status(200).json({ score });
  } catch (error) {
    console.error("Error fetching score:", error);
    res.status(500).json({
      message: "Failed to fetch score",
      error: error.message,
    });
  }
};

exports.updateScoreByMatchId = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { playerA, playerB, setOne, setTwo, setThree, winner } = req.body;

    if (!playerA || !playerB || !setOne || !setTwo || !winner) {
      return res.status(400).json({
        message: "Missing required fields",
        received: { playerA, playerB, setOne, setTwo, setThree, winner },
      });
    }

    const match = await Match.findById(matchId);
    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    const playerIdsInMatch = [
      match.player1.toString(),
      match.player2.toString(),
    ];

    if (!playerIdsInMatch.includes(playerA) || !playerIdsInMatch.includes(playerB)) {
      return res.status(400).json({
        message: "Players must belong to the match",
        validPlayers: playerIdsInMatch,
      });
    }

    if (![playerA, playerB].includes(winner)) {
      return res.status(400).json({ message: "Winner must be one of the two players" });
    }

    const isValidScore = (score) => {
      let a, b;
      if (Array.isArray(score)) {
        [a, b] = score;
      } else if (typeof score === "string" && score.includes("-")) {
        [a, b] = score.split("-").map(Number);
      }
      return typeof a === 'number' && typeof b === 'number' && (a >= 11 || b >= 11);
    };

    if (![setOne, setTwo].every(isValidScore) || (setThree && !isValidScore(setThree))) {
      return res.status(400).json({
        message: "Each set must have at least 11 points by any player",
      });
    }

    const updatedScore = await Score.findOneAndUpdate(
      { matchId },
      {
        playerA,
        playerB,
        setOne,
        setTwo,
        setThree,
        winner,
      },
      { new: true }
    );

    if (!updatedScore) {
      return res.status(404).json({ message: "Score not found for this match" });
    }

    res.status(200).json({
      message: "Score updated successfully",
      updatedScore,
    });
  } catch (error) {
    console.error("Error updating score:", error);
    res.status(500).json({
      message: "Failed to update score",
      error: error.message,
    });
  }
};

exports.deleteScoreByMatchId = async (req, res) => {
  try {
    const { matchId } = req.params;

    const deleted = await Score.findOneAndDelete({ matchId });

    if (!deleted) {
      return res.status(404).json({ message: "Score not found for this match" });
    }

    res.status(200).json({
      message: "Score deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting score:", error);
    res.status(500).json({
      message: "Failed to delete score",
      error: error.message,
    });
  }
};

exports.getScoresByMatchIdArray = async (req, res) => {
  try {
    const { matchId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      return res.status(400).json([]);
    }

    // Fetch all scores for this match (latest first)
    const scores = await Score.find({ matchId }).sort({ createdAt: -1 });

    // Fetch match to get detailed player info
    const match = await Match.findById(matchId)
      .populate('player1.playerId', 'name userName profileImage')
      .populate('player2.playerId', 'name userName profileImage');

    if (!match) {
      return res.status(404).json([]);
    }

    // Extract player information with fallbacks
    const player1Id = match.player1?.playerId?._id?.toString() || match.player1?.playerId?.toString();
    const player2Id = match.player2?.playerId?._id?.toString() || match.player2?.playerId?.toString();

    const player1Name = match.player1?.playerId?.userName ||
      match.player1?.playerId?.name ||
      match.player1?.userName ||
      'Player 1';
    const player2Name = match.player2?.playerId?.userName ||
      match.player2?.playerId?.name ||
      match.player2?.userName ||
      'Player 2';

    if (scores.length === 0) {
      return res.status(200).json([]);
    }

    // Transform scores with enhanced data processing
    const transformedScores = scores.map((score, idx) => {

      // Smart set conversion - handles both string and array formats
      const convertSetToArray = (setData) => {
        if (!setData) return [0, 0];

        if (Array.isArray(setData)) {
          return setData.length >= 2 ? [parseInt(setData[0]) || 0, parseInt(setData[1]) || 0] : [0, 0];
        }

        if (typeof setData === 'string' && setData.includes('-')) {
          const parts = setData.split('-').map(s => parseInt(s.trim()) || 0);
          return parts.length >= 2 ? [parts[0], parts[1]] : [0, 0];
        }

        return [0, 0];
      };

      // Enhanced player name mapping
      let playerAName = 'Unknown Player A';
      let playerBName = 'Unknown Player B';

      // Map playerA
      if (score.playerA === player1Id) {
        playerAName = player1Name;
      } else if (score.playerA === player2Id) {
        playerAName = player2Name;
      }

      // Map playerB
      if (score.playerB === player1Id) {
        playerBName = player1Name;
      } else if (score.playerB === player2Id) {
        playerBName = player2Name;
      }

      // Enhanced transformed score object
      const transformed = {
        _id: score._id,
        matchId: score.matchId,
        playerA: score.playerA,
        playerB: score.playerB,
        playerAName,
        playerBName,

        // Set scores in array format for frontend compatibility
        setOne: convertSetToArray(score.setOne),
        setTwo: convertSetToArray(score.setTwo),
        setThree: score.setThree ? convertSetToArray(score.setThree) : null,

        // Enhanced match statistics - directly from Score record
        gamesWonA: score.gamesWonA !== undefined ? score.gamesWonA : 0,
        gamesWonB: score.gamesWonB !== undefined ? score.gamesWonB : 0,
        totalScoreA: score.totalScoreA !== undefined ? score.totalScoreA : 0,
        totalScoreB: score.totalScoreB !== undefined ? score.totalScoreB : 0,

        // Match outcome
        winner: score.winner,
        matchStatus: score.matchStatus || 'COMPLETED',

        // Metadata
        createdAt: score.createdAt,
        updatedAt: score.updatedAt
      };
      return transformed;
    });

    return res.status(200).json(transformedScores);

  } catch (error) {
    console.error("❌ Error in getScoresByMatchIdArray:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch match scores",
      error: error.message,
      scores: [] // Return empty array for graceful frontend handling
    });
  }
};



// exports.getScoresByMatchIdArray = async (req, res) => {
//   try {
//     const { matchId } = req.params;
//     console.log(`Fetching scores for match: ${matchId}`);

//     // Get scores from Score model only (completed matches should be synced here)
//     // Populate player data to get names for points table
//     const scores = await Score.find({ matchId }).sort({ createdAt: -1 });

//     if (scores && scores.length > 0) {
//       console.log(`Found ${scores.length} scores in Score model`);

//       // Get the match to access player information
//       const match = await Match.findById(matchId)
//         .populate('player1.playerId', 'name userName')
//         .populate('player2.playerId', 'name userName');

//       // Transform scores to match frontend expectations and add player names
//       const transformedScores = scores.map(score => {
//         const convertSetToArray = (setStr) => {
//           if (!setStr) return null;
//           return setStr.split('-').map(num => parseInt(num, 10));
//         };

//         // Add player name information for points table
//         let playerAName = 'Unknown Player';
//         let playerBName = 'Unknown Player';

//         if (match) {
//           // Find which player corresponds to playerA and playerB in the score
//           const player1Id = match.player1.playerId?._id?.toString() || match.player1.playerId?.toString();
//           const player2Id = match.player2.playerId?._id?.toString() || match.player2.playerId?.toString();

//           if (score.playerA === player1Id) {
//             playerAName = match.player1.playerId?.userName || match.player1.playerId?.name || match.player1.userName || 'Player 1';
//           } else if (score.playerA === player2Id) {
//             playerAName = match.player2.playerId?.userName || match.player2.playerId?.name || match.player2.userName || 'Player 2';
//           }

//           if (score.playerB === player1Id) {
//             playerBName = match.player1.playerId?.userName || match.player1.playerId?.name || match.player1.userName || 'Player 1';
//           } else if (score.playerB === player2Id) {
//             playerBName = match.player2.playerId?.userName || match.player2.playerId?.name || match.player2.userName || 'Player 2';
//           }
//         }

//         return {
//           ...score.toObject(),
//           setOne: convertSetToArray(score.setOne),
//           setTwo: convertSetToArray(score.setTwo),
//           setThree: score.setThree ? convertSetToArray(score.setThree) : null,
//           playerAName, // Add player names for frontend display
//           playerBName,
//           // DOCX Requirements: Include comprehensive statistics
//           gamesWonA: score.gamesWonA || 0,
//           gamesWonB: score.gamesWonB || 0,
//           totalScoreA: score.totalScoreA || 0,
//           totalScoreB: score.totalScoreB || 0
//         };
//       });
//       return res.status(200).json(transformedScores);
//     }

//     // No scores found - this means completed matches haven't been synced yet
//     console.log('No scores found in Score model. If match is completed, it needs to be synced.');
//     return res.status(200).json([]);

//   } catch (error) {
//     console.error("Error fetching scores array:", error);
//     res.status(500).json({
//       message: "Failed to fetch scores",
//       error: error.message,
//     });
//   }
// };

exports.saveTopPlayers = async (req, res) => {
  try {
    const { tournamentId, groupId, groupName, topPlayers, players } = req.body;

    if (!tournamentId || !groupId) {
      return res.status(400).json({
        success: false,
        message: "Tournament ID and Group ID are required",
      });
    }

    // Handle seeded players format (players) or existing top players format (topPlayers)
    let formattedTopPlayers = [];

    if (players && Array.isArray(players) && players.length > 0) {
      // Store in both legacy and new format for compatibility
      formattedTopPlayers = players
        .filter(player => player.playerId || player.id || player._id) // Filter out invalid entries
        .map(player => ({
          playerId: player.playerId || player._id || player.id,
          playerName: player.playerName || player.name || player.userName || "Unknown Player",
          userName: player.playerName || player.name || player.userName || "Unknown Player",
          category: player.category || 'Open',
          points: 0, // Default points for seeded players
          setsWon: 0,
          setsLost: 0,
          won: 0,
          lost: 0,
          played: 0,
          status: 'top_player',
          sourceRound: 1
        }));
    } else if (topPlayers && Array.isArray(topPlayers)) {
      // Use existing top players format
      formattedTopPlayers = topPlayers.filter(player => player.playerId || player._id);
    } else {
      console.log("Empty or invalid players list, proceeding to clear group if needed.");
      // ALLOW empty list to clear the group choice!
    }

    // 🚀 DUPLICATE PLAYER VALIDATION
    // Check if any of these players are already in the top players list for this tournament
    // in OTHER groups.
    const existingTopPlayersInTournament = await TopPlayers.find({
      tournamentId,
      groupId: { $ne: groupId } // Exclude current group
    });

    // Flatten all existing players from other groups
    const existingPlayerIds = new Set();
    const existingPlayerNames = new Map(); // Map playerId -> { name, groupName }

    existingTopPlayersInTournament.forEach(groupDoc => {
      const playersList = (groupDoc.players && groupDoc.players.length > 0) ? groupDoc.players : groupDoc.topPlayers;
      if (playersList && Array.isArray(playersList)) {
        playersList.forEach(p => {
          const pid = p.playerId || p._id;
          if (pid) {
            const pidStr = pid.toString();
            existingPlayerIds.add(pidStr);
            if (!existingPlayerNames.has(pidStr)) {
              existingPlayerNames.set(pidStr, {
                name: p.playerName || p.userName || "Unknown",
                groupName: groupDoc.groupName
              });
            }
          }
        });
      }
    });

    // Check for duplicates in the new players being added
    const duplicatePlayers = [];
    formattedTopPlayers.forEach(player => {
      const pid = player.playerId;
      if (pid) {
        const pidStr = pid.toString();
        if (existingPlayerIds.has(pidStr)) {
          const existingInfo = existingPlayerNames.get(pidStr);
          duplicatePlayers.push({
            playerName: player.playerName,
            existingGroup: existingInfo ? existingInfo.groupName : "another group"
          });
        }
      }
    });

    // If duplicates found, reject the request
    if (duplicatePlayers.length > 0) {
      const duplicateList = duplicatePlayers.map(p =>
        `"${p.playerName}" (already in ${p.existingGroup})`
      ).join(', ');

      console.log("❌ Duplicate players detected:", duplicateList);
      return res.status(400).json({
        success: false,
        message: `Cannot add players: The following players are already in the top players list: ${duplicateList}`,
        duplicatePlayers: duplicatePlayers,
      });
    }

    // Generate group name if not provided
    const finalGroupName = groupName || `Seeded Players - ${groupId}`;

    // Find if a record already exists for this group
    let topPlayersDoc = await TopPlayers.findOne({ tournamentId, groupId });

    if (!topPlayersDoc) {
      // If document doesn't exist and we have players, create it
      if (formattedTopPlayers.length > 0) {
        topPlayersDoc = new TopPlayers({
          tournamentId,
          groupId,
          groupName: finalGroupName,
          topPlayers: formattedTopPlayers,
          players: formattedTopPlayers
        });
        await topPlayersDoc.save();
        console.log(`Created new top player group "${finalGroupName}" with ${formattedTopPlayers.length} players`);
      }
    } else {
      // If document exists
      if (formattedTopPlayers.length > 0) {
        // Filter out players already in this group to avoid duplicates within the same group
        const existingPlayerIds = new Set();

        // Check both arrays for existing IDs
        if (topPlayersDoc.players) {
          topPlayersDoc.players.forEach(p => {
            if (p.playerId) existingPlayerIds.add(p.playerId.toString());
          });
        }
        if (topPlayersDoc.topPlayers) {
          topPlayersDoc.topPlayers.forEach(p => {
            if (p.playerId) existingPlayerIds.add(p.playerId.toString());
          });
        }

        const newPlayersToAppend = formattedTopPlayers.filter(
          p => !existingPlayerIds.has(p.playerId.toString())
        );

        if (newPlayersToAppend.length > 0) {
          // Push new players to both arrays
          topPlayersDoc.topPlayers.push(...newPlayersToAppend);
          topPlayersDoc.players.push(...newPlayersToAppend);
          topPlayersDoc.groupName = finalGroupName; // Update name
          await topPlayersDoc.save();
          console.log(`Appended ${newPlayersToAppend.length} players to existing group "${finalGroupName}"`);
        } else {
          console.log(`No new players to append for group "${finalGroupName}" (all already exist)`);
        }
      } else {
        // If empty list sent, delete the whole group record
        await TopPlayers.deleteOne({ _id: topPlayersDoc._id });
        console.log(`Deleted empty top player group: ${groupId}`);
        topPlayersDoc = null;
      }
    }

    res.json({
      success: true,
      message: topPlayersDoc ? "Top players updated successfully" : "Top players cleared successfully",
      data: topPlayersDoc,
    });

  } catch (error) {
    console.error("=== ERROR SAVING TOP PLAYERS ===");
    console.error("Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to save top players",
      error: error.message,
    });
  }
};

exports.getTopPlayersByGroup = async (req, res) => {
  try {
    const { tournamentId, groupId } = req.params;

    const topPlayers = await TopPlayers.findOne({ tournamentId, groupId });

    if (!topPlayers) {
      return res.json({
        success: false,
        message: "No top players found for this group",
      });
    }

    res.json({
      success: true,
      data: topPlayers,
    });
  } catch (error) {
    console.error("Error fetching top players:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch top players",
    });
  }
};

exports.getTopPlayersByTournament = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    const topPlayers = await TopPlayers.find({ tournamentId });

    if (!topPlayers || topPlayers.length === 0) {
      return res.json({
        success: false,
        message: "No top players found for this tournament",
        topPlayers: []
      });
    }

    // Flatten the top players from all groups for the frontend
    const flattenedTopPlayers = topPlayers.flatMap(group => {
      // Prefer the new 'players' array structure, fallback to legacy 'topPlayers'
      const playersList = (group.players && group.players.length > 0) ? group.players : group.topPlayers;

      return playersList.map(player => ({
        _id: player._id,
        playerId: player.playerId || player._id, // Use playerId from new structure, fallback to _id for legacy
        playerName: player.playerName || player.userName, // New structure uses playerName
        userName: player.userName || player.playerName,   // Legacy compatibility
        points: player.points,
        setsWon: player.setsWon,
        setsLost: player.setsLost,
        won: player.won,
        lost: player.lost,
        played: player.played,
        category: player.category || 'Open',
        groupId: group.groupId,
        groupName: group.groupName,
        status: player.status || 'top_player',
        sourceRound: player.sourceRound || 1
      }));
    });

    // 📱 STANDARD RESPONSE
    res.json({
      success: true,
      topPlayers: flattenedTopPlayers,
    });
  } catch (error) {
    console.error("Error fetching top players by tournament:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch top players for the tournament",
      topPlayers: []
    });
  }
};


exports.getLogo = async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.id);

    if (!tournament) {
      console.error("Tournament not found with ID:", req.params.id);
      return res.status(404).json({ error: "Tournament not found" });
    }

    if (!tournament.tournamentLogo) {
      console.error(
        "Tournament logo not found for tournament:",
        tournament.title
      );
      return res.status(404).json({ error: "Tournament logo not found" });
    }

    // Construct the full path to the tournament logo file using the uploadsDir
    const logoPath = path.join(
      __dirname,
      "..",
      "uploads",
      tournament.tournamentLogo
    );
    console.log("Full tournament logo path:", logoPath);

    // Check if the file exists
    if (!fs.existsSync(logoPath)) {
      console.error("Tournament logo file not found at path:", logoPath);
      return res.status(404).json({ error: "Tournament logo file not found" });
    }

    // Set the appropriate content type based on the file extension
    const fileExtension = path.extname(logoPath).toLowerCase().slice(1);
    const contentTypes = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
    };
    const contentType =
      contentTypes[fileExtension] || "application/octet-stream";
    console.log("Tournament logo file content type:", contentType);

    // Set response headers
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600"); // Cache for 1 hour

    // Stream the file instead of loading it entirely into memory
    const fileStream = fs.createReadStream(logoPath);
    fileStream.pipe(res);

    // Handle stream errors
    fileStream.on("error", (err) => {
      console.error("Error streaming tournament logo:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error serving tournament logo" });
      }
    });

    // Log success after the stream ends
    fileStream.on("end", () => {
      console.log("Tournament logo served successfully");
    });
  } catch (error) {
    console.error("Error fetching tournament logo:", error);
    if (!res.headersSent) {
      return res.status(500).json({ error: "Error fetching tournament logo" });
    }
  }
};

//*Tournament Progression System*//

// Add seeded players to tournament
exports.addSeededPlayers = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { seededPlayers } = req.body;

    if (!Array.isArray(seededPlayers) || seededPlayers.length === 0) {
      return res.status(400).json({
        success: false,
        message: "seededPlayers array is required"
      });
    }

    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }

    // Validate and update seeded players
    for (const seedData of seededPlayers) {
      const { playerId, seedRank } = seedData;

      // Check if player exists
      const player = await User.findById(playerId);
      if (!player) {
        return res.status(404).json({
          success: false,
          message: `Player with ID ${playerId} not found`
        });
      }

      // Update player type to seeded
      await User.findByIdAndUpdate(playerId, {
        playerType: "seeded",
        seedRank: seedRank,
        nationalRanking: seedData.nationalRanking || null
      });
    }

    // Update tournament with seeded players
    tournament.seededPlayers = seededPlayers;
    await tournament.save();

    res.status(200).json({
      success: true,
      message: "Seeded players added successfully",
      tournament
    });

  } catch (error) {
    console.error("Error adding seeded players:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add seeded players",
      error: error.message
    });
  }
};

// Generate Qualifier Knockout matches (Round 2)
exports.generateQualifierKnockout = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { category } = req.query;

    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }

    // Get top players from group stage for this category
    const topPlayersData = await TopPlayers.find({
      tournamentId: tournamentId
    }).populate('topPlayers');

    if (!topPlayersData || topPlayersData.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No group stage results found. Complete group stage first."
      });
    }

    // Extract all top players and mark them as Super Players
    const superPlayers = [];
    for (const groupData of topPlayersData) {
      for (const playerData of groupData.topPlayers) {
        // Update player type to super
        await User.findOneAndUpdate(
          { name: playerData.userName },
          { playerType: "super" }
        );

        const user = await User.findOne({ name: playerData.userName });
        if (user) {
          superPlayers.push({
            playerId: user._id,
            playerName: user.name,
            playerType: "super",
            fromGroup: groupData.groupName,
            points: playerData.points
          });
        }
      }
    }

    console.log("Super players:", superPlayers);

    // Generate qualifier knockout bracket
    const qualifierMatches = await generateKnockoutBracket(
      superPlayers,
      tournamentId,
      "qualifier_knockout",
      2,
      "Qualifier",
      category || "Open"
    );

    // Update tournament stage
    await Tournament.findByIdAndUpdate(tournamentId, {
      currentStage: "qualifier_knockout",
      "stageConfig.groupStage.completed": true
    });

    res.status(201).json({
      success: true,
      message: "Qualifier knockout matches generated successfully",
      matches: qualifierMatches,
      superPlayersCount: superPlayers.length
    });

  } catch (error) {
    console.error("Error generating qualifier knockout:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate qualifier knockout",
      error: error.message
    });
  }
};

// Generate Main Knockout Stage (Round 3) - Merge Super + Seeded Players
exports.generateMainKnockout = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { category } = req.query;

    const tournament = await Tournament.findById(tournamentId).populate('seededPlayers.playerId');
    if (!tournament) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }

    // Get qualifier knockout winners (Super Players who won Round 2)
    const qualifierMatches = await KnockoutMatch.find({
      tournamentId,
      matchType: "qualifier_knockout",
      status: "COMPLETED"
    });

    const qualifierWinners = qualifierMatches
      .filter(match => match.winner && match.winner.playerId)
      .map(match => ({
        playerId: match.winner.playerId,
        playerName: match.winner.playerName,
        playerType: "super",
        fromQualifier: true
      }));

    console.log("Qualifier winners:", qualifierWinners);

    // Get seeded players for this category
    const seededPlayers = tournament.seededPlayers
      .filter(seed => !category || seed.category === category)
      .map(seed => ({
        playerId: seed.playerId._id,
        playerName: seed.playerId.name,
        playerType: "seeded",
        seedRank: seed.seedRank,
        autoAdvanced: true
      }));

    console.log("Seeded players:", seededPlayers);

    // Merge Super Players + Seeded Players
    const mainKnockoutPlayers = [...qualifierWinners, ...seededPlayers];

    console.log("Main knockout players:", mainKnockoutPlayers.length);

    // Generate main knockout bracket
    const mainKnockoutMatches = await generateKnockoutBracket(
      mainKnockoutPlayers,
      tournamentId,
      "main_knockout",
      3,
      "Main Knockout",
      category || "Open"
    );

    // Update tournament stage
    await Tournament.findByIdAndUpdate(tournamentId, {
      currentStage: "main_knockout",
      "stageConfig.qualifierKnockout.completed": true
    });

    res.status(201).json({
      success: true,
      message: "Main knockout matches generated successfully",
      matches: mainKnockoutMatches,
      totalPlayers: mainKnockoutPlayers.length,
      superPlayers: qualifierWinners.length,
      seededPlayers: seededPlayers.length
    });

  } catch (error) {
    console.error("Error generating main knockout:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate main knockout",
      error: error.message
    });
  }
};

// Bracket Generation Algorithm with Bye System
const generateKnockoutBracket = async (players, tournamentId, matchType, round, roundName, category) => {
  try {
    const totalPlayers = players.length;

    // Calculate next power of 2 to determine bracket size
    const nextPowerOf2 = Math.pow(2, Math.ceil(Math.log2(totalPlayers)));
    const byesNeeded = nextPowerOf2 - totalPlayers;

    console.log(`Total players: ${totalPlayers}, Next power of 2: ${nextPowerOf2}, Byes needed: ${byesNeeded}`);

    // Shuffle players for fair bracket distribution
    const shuffledPlayers = [...players].sort(() => Math.random() - 0.5);

    // For seeded players, place them strategically to avoid early encounters
    if (matchType === "main_knockout") {
      shuffledPlayers.sort((a, b) => {
        if (a.playerType === "seeded" && b.playerType === "seeded") {
          return a.seedRank - b.seedRank; // Lower seed rank comes first
        }
        if (a.playerType === "seeded") return -1;
        if (b.playerType === "seeded") return 1;
        return 0;
      });
    }

    const matches = [];
    let bracketPosition = 1;

    // Create matches, handling byes
    for (let i = 0; i < shuffledPlayers.length; i += 2) {
      const player1 = shuffledPlayers[i];
      const player2 = shuffledPlayers[i + 1] || null;

      // Determine if this is a bye match
      const isBye = !player2;
      let status = "SCHEDULED";
      let winner = null;

      if (isBye) {
        status = "BYE";
        winner = {
          playerId: player1.playerId,
          playerName: player1.playerName,
          playerType: player1.playerType
        };
      }

      const match = new KnockoutMatch({
        tournamentId,
        matchType,
        round,
        roundName,
        bracketPosition,
        player1: {
          playerId: player1.playerId,
          playerName: player1.playerName,
          playerType: player1.playerType,
          seedRank: player1.seedRank || null,
          fromGroup: player1.fromGroup || null
        },
        player2: player2 ? {
          playerId: player2.playerId,
          playerName: player2.playerName,
          playerType: player2.playerType,
          seedRank: player2.seedRank || null,
          fromGroup: player2.fromGroup || null
        } : {
          playerId: new mongoose.Types.ObjectId(),
          playerName: "BYE",
          playerType: "general"
        },
        category,
        status,
        isBye,
        winner,
        scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Default to tomorrow
        scheduledTime: {
          startTime: "10:00",
          endTime: "11:00"
        }
      });

      await match.save();
      matches.push(match);
      bracketPosition++;
    }

    console.log(`Generated ${matches.length} matches for ${roundName}`);
    return matches;

  } catch (error) {
    console.error("Error in generateKnockoutBracket:", error);
    throw error;
  }
};

// Get tournament progression status
exports.getTournamentProgression = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    const tournament = await Tournament.findById(tournamentId).populate('seededPlayers.playerId');
    if (!tournament) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }

    // Get group stage status
    const groupStageGroups = await BookingGroup.find({ tournamentId });
    const groupStageMatches = await Match.find({ tournamentId });
    const topPlayers = await TopPlayers.find({ tournamentId });

    // Get knockout matches
    const qualifierMatches = await KnockoutMatch.find({
      tournamentId,
      matchType: "qualifier_knockout"
    });

    const mainKnockoutMatches = await KnockoutMatch.find({
      tournamentId,
      matchType: "main_knockout"
    });

    const progression = {
      currentStage: tournament.currentStage,
      stageConfig: tournament.stageConfig,
      groupStage: {
        totalGroups: groupStageGroups.length,
        totalMatches: groupStageMatches.length,
        completedMatches: groupStageMatches.filter(m => m.status === "COMPLETED").length,
        topPlayersSelected: topPlayers.length > 0
      },
      qualifierKnockout: {
        totalMatches: qualifierMatches.length,
        completedMatches: qualifierMatches.filter(m => m.status === "COMPLETED").length,
        superPlayersQualified: qualifierMatches.filter(m => m.winner).length
      },
      mainKnockout: {
        totalMatches: mainKnockoutMatches.length,
        completedMatches: mainKnockoutMatches.filter(m => m.status === "COMPLETED").length,
        seededPlayersCount: tournament.seededPlayers.length
      }
    };

    res.status(200).json({
      success: true,
      progression,
      tournament: {
        id: tournament._id,
        title: tournament.title,
        currentStage: tournament.currentStage,
        tournamentStatus: tournament.tournamentStatus
      }
    });

  } catch (error) {
    console.error("Error getting tournament progression:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get tournament progression",
      error: error.message
    });
  }
};

//* MATCH FORMAT CONFIGURATION CONTROLLERS *//

// 🚀 Get Available Match Format Options (for UI dropdowns)
exports.getMatchFormatOptions = async (req, res) => {
  try {
    const options = {
      success: true,
      setsOptions: [
        { value: 3, label: "3 Sets (First to 2 wins)", description: "Quick matches" },
        { value: 5, label: "5 Sets (First to 3 wins)", description: "Standard tournament" },
        { value: 7, label: "7 Sets (First to 4 wins)", description: "Epic matches" }
      ],
      gamesOptions: [
        { value: 3, label: "3 Games (First to 2 wins set)", description: "Fast sets" },
        { value: 5, label: "5 Games (First to 3 wins set)", description: "Standard sets" },
        { value: 7, label: "7 Games (First to 4 wins set)", description: "Long sets" }
      ],
      combinations: [
        { sets: 3, games: 3, name: "Quick Match", duration: "~15 min" },
        { sets: 3, games: 5, name: "Standard Short", duration: "~25 min" },
        { sets: 3, games: 7, name: "Long Games", duration: "~35 min" },
        { sets: 5, games: 3, name: "Fast Tournament", duration: "~25 min" },
        { sets: 5, games: 5, name: "Tournament Standard", duration: "~45 min" },
        { sets: 5, games: 7, name: "Extended Match", duration: "~60 min" },
        { sets: 7, games: 3, name: "Sprint Epic", duration: "~35 min" },
        { sets: 7, games: 5, name: "Professional", duration: "~75 min" },
        { sets: 7, games: 7, name: "Marathon", duration: "~90 min" }
      ]
    };

    res.status(200).json(options);
  } catch (error) {
    console.error("Error fetching match format options:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch match format options",
      error: error.message
    });
  }
};

// Get Tournament Match Format Configuration
exports.getTournamentMatchFormat = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    const tournament = await Tournament.findById(tournamentId).select('matchFormat title');
    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    res.status(200).json({
      success: true,
      tournamentId: tournament._id,
      tournamentTitle: tournament.title,
      matchFormat: tournament.matchFormat || {
        // 🎯 FLEXIBLE CONFIGURATION - Use new field names with auto-calculation
        totalSets: 5,
        setsToWin: 3,
        maxSets: 5, // Backward compatibility
        totalGames: 5,
        gamesToWin: 3,
        maxGames: 5, // Backward compatibility
        pointsToWinGame: 11,
        marginToWin: 2,
        deuceRule: true,
        maxPointsPerGame: null,
        serviceRule: {
          pointsPerService: 2,
          deuceServicePoints: 1
        }
      }
    });
  } catch (error) {
    console.error("Error fetching tournament match format:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch tournament match format",
      error: error.message
    });
  }
};

// Update Tournament Match Format Configuration
exports.updateTournamentMatchFormat = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { matchFormat } = req.body;

    // Validate match format structure
    const validationErrors = validateMatchFormat(matchFormat);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid match format configuration",
        errors: validationErrors
      });
    }

    const tournament = await Tournament.findByIdAndUpdate(
      tournamentId,
      { matchFormat, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!tournament) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Tournament match format updated successfully",
      matchFormat: tournament.matchFormat
    });
  } catch (error) {
    console.error("Error updating tournament match format:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update tournament match format",
      error: error.message
    });
  }
};

// Get Specific Match Format Configuration
exports.getMatchFormat = async (req, res) => {
  try {
    const { matchId } = req.params;

    const match = await Match.findById(matchId)
      .select('matchFormat')
      .populate('tournamentId', 'matchFormat title');

    if (!match) {
      return res.status(404).json({
        success: false,
        message: "Match not found"
      });
    }

    // Match format inherits from tournament but can be overridden
    const inheritedFormat = match.tournamentId?.matchFormat || {};
    const matchFormat = { ...inheritedFormat, ...match.matchFormat };

    res.status(200).json({
      success: true,
      matchId: match._id,
      tournamentTitle: match.tournamentId?.title,
      matchFormat,
      isInherited: Object.keys(match.matchFormat || {}).length === 0
    });
  } catch (error) {
    console.error("Error fetching match format:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch match format",
      error: error.message
    });
  }
};

// Update Specific Match Format Configuration
exports.updateMatchFormat = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { matchFormat } = req.body;

    // Validate match format
    const validationErrors = validateMatchFormat(matchFormat);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid match format configuration",
        errors: validationErrors
      });
    }

    const match = await Match.findByIdAndUpdate(
      matchId,
      { matchFormat },
      { new: true, runValidators: true }
    ).populate('tournamentId', 'matchFormat title');

    if (!match) {
      return res.status(404).json({
        success: false,
        message: "Match not found"
      });
    }

    // Return merged configuration
    const inheritedFormat = match.tournamentId?.matchFormat || {};
    const finalFormat = { ...inheritedFormat, ...match.matchFormat };

    res.status(200).json({
      success: true,
      message: "Match format updated successfully",
      matchId: match._id,
      matchFormat: finalFormat
    });
  } catch (error) {
    console.error("Error updating match format:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update match format",
      error: error.message
    });
  }
};

// Helper function to validate match format
// 🚀 ENHANCED FLEXIBLE VALIDATION - Supports independent Sets & Games configuration
function validateMatchFormat(matchFormat) {
  const errors = [];

  if (!matchFormat) {
    errors.push("Match format is required");
    return errors;
  }

  // 🎯 FLEXIBLE SETS VALIDATION & AUTO-CALCULATION
  if (matchFormat.totalSets) {
    if (![3, 5, 7].includes(matchFormat.totalSets)) {
      errors.push("totalSets must be 3, 5, or 7");
    } else {
      // 🔥 AUTO-CALCULATE setsToWin based on totalSets
      matchFormat.setsToWin = Math.ceil(matchFormat.totalSets / 2);
      matchFormat.maxSets = matchFormat.totalSets; // Backward compatibility

      console.log(`🎯 Sets Auto-calculated: ${matchFormat.totalSets} total → First to ${matchFormat.setsToWin} wins match`);
    }
  }

  // 🎯 FLEXIBLE GAMES VALIDATION & AUTO-CALCULATION
  if (matchFormat.totalGames) {
    if (![3, 5, 7].includes(matchFormat.totalGames)) {
      errors.push("totalGames must be 3, 5, or 7");
    } else {
      // 🔥 AUTO-CALCULATE gamesToWin based on totalGames
      matchFormat.gamesToWin = Math.ceil(matchFormat.totalGames / 2);
      matchFormat.maxGames = matchFormat.totalGames; // Backward compatibility

      console.log(`🎯 Games Auto-calculated: ${matchFormat.totalGames} total → First to ${matchFormat.gamesToWin} wins set`);
    }
  }

  // 🔄 BACKWARD COMPATIBILITY - Support old format
  if (!matchFormat.totalSets && matchFormat.maxSets) {
    if ([3, 5, 7].includes(matchFormat.maxSets)) {
      matchFormat.totalSets = matchFormat.maxSets;
      matchFormat.setsToWin = Math.ceil(matchFormat.maxSets / 2);
      console.log(`🔄 Legacy: maxSets ${matchFormat.maxSets} → totalSets ${matchFormat.totalSets}, setsToWin ${matchFormat.setsToWin}`);
    }
  }

  if (!matchFormat.totalGames && matchFormat.maxGames) {
    if ([3, 5, 7].includes(matchFormat.maxGames)) {
      matchFormat.totalGames = matchFormat.maxGames;
      matchFormat.gamesToWin = Math.ceil(matchFormat.maxGames / 2);
      console.log(`🔄 Legacy: maxGames ${matchFormat.maxGames} → totalGames ${matchFormat.totalGames}, gamesToWin ${matchFormat.gamesToWin}`);
    }
  }

  // 🔍 VALIDATION FOR AUTO-CALCULATED VALUES
  if (matchFormat.setsToWin && ![2, 3, 4].includes(matchFormat.setsToWin)) {
    errors.push("setsToWin must be 2 (for 3 sets), 3 (for 5 sets), or 4 (for 7 sets)");
  }

  if (matchFormat.gamesToWin && ![2, 3, 4].includes(matchFormat.gamesToWin)) {
    errors.push("gamesToWin must be 2 (for 3 games), 3 (for 5 games), or 4 (for 7 games)");
  }

  // Validate points configuration
  if (matchFormat.pointsToWinGame && kmatchFormat.pointsToWinGame < 1) {
    errors.push("pointsToWinGame must be at least 1");
  }

  if (matchFormat.marginToWin && matchFormat.marginToWin < 1) {
    errors.push("marginToWin must be at least 1");
  }

  // Validate service rules
  if (matchFormat.serviceRule) {
    if (matchFormat.serviceRule.pointsPerService && matchFormat.serviceRule.pointsPerService < 1) {
      errors.push("pointsPerService must be at least 1");
    }
    if (matchFormat.serviceRule.deuceServicePoints && matchFormat.serviceRule.deuceServicePoints < 1) {
      errors.push("deuceServicePoints must be at least 1");
    }
  }

  return errors;
}

// Add the missing getMatchesByGroup method
exports.getMatchesByGroup = async (req, res) => {
  try {
    const { tournamentId, groupId } = req.params;

    if (!tournamentId || !groupId) {
      return res.status(400).json({
        success: false,
        message: "Tournament ID and Group ID are required"
      });
    }

    const matches = await Match.find({ tournamentId, groupId })
      .populate('player1.playerId', 'name userName profileImage')
      .populate('player2.playerId', 'name userName profileImage')
      .populate('tournamentId', 'title type matchFormat')
      .sort({ matchNumber: 1 });

    if (!matches || matches.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No matches found for this group",
        matches: []
      });
    }

    // Enrich matches with proper structure for frontend - with null safety
    const enrichedMatches = matches.map(match => {
      const matchObj = match.toObject();

      return {
        ...matchObj,
        player1: {
          playerId: match.player1?.playerId?._id || match.player1?.playerId,
          userName: match.player1?.playerId?.userName ||
            match.player1?.playerId?.name ||
            match.player1?.userName ||
            'Unknown Player',
          name: match.player1?.playerId?.name || match.player1?.userName || 'Unknown Player',
          profileImage: match.player1?.playerId?.profileImage
        },
        player2: {
          playerId: match.player2?.playerId?._id || match.player2?.playerId,
          userName: match.player2?.playerId?.userName ||
            match.player2?.playerId?.name ||
            match.player2?.userName ||
            'Unknown Player',
          name: match.player2?.playerId?.name || match.player2?.userName || 'Unknown Player',
          profileImage: match.player2?.playerId?.profileImage
        }
      };
    });

    res.status(200).json({
      success: true,
      matches: enrichedMatches
    });

  } catch (error) {
    console.error("Error fetching matches by group:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch matches",
      error: error.message
    });
  }
};

// ===================== CLEANUP FUNCTIONS =====================

// Clean up Super Players incorrectly added to Top Players list
exports.cleanupSuperPlayersFromTopPlayers = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    console.log("=== CLEANUP: Removing Super Players from Top Players ===");
    console.log("Tournament ID:", tournamentId);

    // Get all Top Players documents for this tournament using the same method as getTopPlayersByTournament
    const topPlayers = await TopPlayers.find({ tournamentId });
    console.log("Found top players groups:", topPlayers.length);

    if (!topPlayers || topPlayers.length === 0) {
      return res.json({
        success: true,
        message: "No Top Players found to clean up",
        removedCount: 0
      });
    }

    // Flatten the top players data like in getTopPlayersByTournament
    let allTopPlayers = [];
    topPlayers.forEach(group => {
      if (group.topPlayers && Array.isArray(group.topPlayers)) {
        group.topPlayers.forEach(player => {
          allTopPlayers.push({
            ...player.toObject ? player.toObject() : player,
            groupId: group.groupId,
            groupName: group.groupName || group.groupId,
            groupDoc: group // Keep reference to original document
          });
        });
      }
    });

    console.log("Total flattened players:", allTopPlayers.length);

    // Identify Super Players based on characteristics
    let superPlayersToRemove = [];
    let legitimateTopPlayers = [];

    allTopPlayers.forEach(player => {
      const isSuperPlayer = (
        // 1. Status field indicates super_player
        player.status === 'super_player' ||
        // 2. Source round is 2 (indicates Round 2 winner)
        player.sourceRound === 2 ||
        // 3. Group ID contains "super_players"
        (player.groupId && player.groupId.toString().includes('super_players')) ||
        // 4. Group name contains "Super Players"
        (player.groupName && player.groupName.includes('Super Players'))
      );

      if (isSuperPlayer) {
        console.log(`Found Super Player to remove:`, {
          name: player.userName || player.playerName,
          status: player.status,
          sourceRound: player.sourceRound,
          groupId: player.groupId,
          groupName: player.groupName
        });
        superPlayersToRemove.push(player);
      } else {
        legitimateTopPlayers.push(player);
      }
    });

    console.log(`Super Players to remove: ${superPlayersToRemove.length}`);
    console.log(`Legitimate Top Players to keep: ${legitimateTopPlayers.length}`);

    if (superPlayersToRemove.length === 0) {
      return res.json({
        success: true,
        message: "No Super Players found to clean up",
        removedCount: 0
      });
    }

    // Group the cleanup by document/group for efficient updates
    let cleanupResults = [];

    // Process removals by group
    for (const group of topPlayers) {
      const originalCount = group.topPlayers ? group.topPlayers.length : 0;

      if (!group.topPlayers || !Array.isArray(group.topPlayers)) {
        continue;
      }

      // Filter out Super Players from this group - MORE AGGRESSIVE CLEANUP
      const filteredPlayers = group.topPlayers.filter(player => {
        const playerObj = player.toObject ? player.toObject() : player;
        const isSuperPlayer = (
          // 1. Status field indicates super_player
          playerObj.status === 'super_player' ||
          // 2. Source round is 2 (indicates Round 2 winner)
          playerObj.sourceRound === 2 ||
          // 3. Group ID contains "super_players" or "round_2"
          (group.groupId && (
            group.groupId.toString().includes('super_players') ||
            group.groupId.toString().includes('round_2')
          )) ||
          // 4. Group name contains "Super Players" or "Round 2"
          (group.groupName && (
            group.groupName.includes('Super Players') ||
            group.groupName.includes('Round 2')
          )) ||
          // 5. Player name appears multiple times (duplicates from Super Player selection)
          (playerObj.userName && ['Aditya', 'Sneha', 'Jayesh', 'Chaitali'].some(name =>
            playerObj.userName.includes(name) && (
              playerObj.status === 'super_player' ||
              playerObj.sourceRound === 2 ||
              group.groupId.toString().includes('super_players') ||
              group.groupId.toString().includes('round_2')
            )
          ))
        );
        return !isSuperPlayer;
      });

      const removedCount = originalCount - filteredPlayers.length;

      if (removedCount > 0) {
        console.log(`Removing ${removedCount} Super Players from group ${group.groupId}`);

        // Update the group document
        group.topPlayers = filteredPlayers;
        await group.save();

        cleanupResults.push({
          groupId: group.groupId,
          groupName: group.groupName,
          originalCount,
          removedCount,
          newCount: filteredPlayers.length
        });
      }
    }

    const totalRemovedCount = cleanupResults.reduce((sum, result) => sum + result.removedCount, 0);

    console.log("=== CLEANUP COMPLETED ===");
    console.log("Total Super Players removed from Top Players:", totalRemovedCount);

    res.json({
      success: true,
      message: `Successfully cleaned up ${totalRemovedCount} Super Players from Top Players list`,
      removedCount: totalRemovedCount,
      cleanupResults,
      details: `Processed ${topPlayers.length} Top Player groups`
    });

  } catch (error) {
    console.error("Error during Super Players cleanup:", error);
    res.status(500).json({
      success: false,
      message: "Failed to cleanup Super Players from Top Players",
      error: error.message
    });
  }
};

// AGGRESSIVE cleanup - Remove ALL Super Players regardless of group
exports.aggressiveCleanupSuperPlayers = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    console.log("=== AGGRESSIVE CLEANUP: Removing ALL Super Players ===");
    console.log("Tournament ID:", tournamentId);

    // Get ALL TopPlayers documents for this tournament
    const topPlayersDocuments = await TopPlayers.find({ tournamentId });
    console.log("Found documents:", topPlayersDocuments.length);

    let totalRemovedCount = 0;
    let processedGroups = [];

    for (const doc of topPlayersDocuments) {
      if (!doc.topPlayers || !Array.isArray(doc.topPlayers)) {
        continue;
      }

      const originalCount = doc.topPlayers.length;
      console.log(`Processing group ${doc.groupId} with ${originalCount} players`);

      // Remove ALL players with super_player status or sourceRound 2
      const filteredPlayers = doc.topPlayers.filter(player => {
        const playerObj = player.toObject ? player.toObject() : player;
        const isSuperPlayer = (
          playerObj.status === 'super_player' ||
          playerObj.sourceRound === 2
        );

        if (isSuperPlayer) {
          console.log(`Removing Super Player: ${playerObj.userName || playerObj.playerName} from group ${doc.groupId}`);
        }

        return !isSuperPlayer; // Keep only legitimate Top Players
      });

      const removedCount = originalCount - filteredPlayers.length;

      if (removedCount > 0) {
        doc.topPlayers = filteredPlayers;
        await doc.save();
        totalRemovedCount += removedCount;

        processedGroups.push({
          groupId: doc.groupId,
          groupName: doc.groupName,
          originalCount,
          removedCount,
          newCount: filteredPlayers.length
        });
      }
    }

    console.log("=== AGGRESSIVE CLEANUP COMPLETED ===");
    console.log("Total removed:", totalRemovedCount);

    res.json({
      success: true,
      message: `Aggressively removed ${totalRemovedCount} Super Players from Top Players`,
      removedCount: totalRemovedCount,
      processedGroups
    });

  } catch (error) {
    console.error("Error during aggressive cleanup:", error);
    res.status(500).json({
      success: false,
      message: "Failed to perform aggressive cleanup",
      error: error.message
    });
  }
};

// Save Super Players (Round 2 Winners)
exports.saveSuperPlayers = async (req, res) => {
  try {
    const { tournamentId, groupId, groupName, round, roundType, players } = req.body;

    console.log("=== SAVING SUPER PLAYERS ===");
    console.log("Tournament ID:", tournamentId);
    console.log("Group ID:", groupId);
    console.log("Round:", round);
    console.log("Round Type:", roundType);
    console.log("Players count:", players.length);
    console.log("Players data:", JSON.stringify(players, null, 2));

    if (!tournamentId || !players || players.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Tournament ID and players are required"
      });
    }

    // Check if Super Players document already exists for this tournament
    let superPlayersDoc = await SuperPlayers.findOne({
      tournamentId
    });

    if (superPlayersDoc) {
      // Append to existing Super Players document
      console.log("Found existing Super Players document, appending new players...");

      // Get existing player IDs to avoid duplicates
      const existingPlayerIds = new Set(
        superPlayersDoc.players.map(p => p.playerId?.toString() || p.playerId)
      );

      // Filter out duplicate players and ensure proper ObjectId conversion
      const newPlayers = players
        .filter(player =>
          !existingPlayerIds.has(player.playerId?.toString() || player.playerId)
        )
        .map(player => ({
          ...player,
          playerId: mongoose.Types.ObjectId.isValid(player.playerId)
            ? new mongoose.Types.ObjectId(player.playerId)
            : player.playerId
        }));

      if (newPlayers.length > 0) {
        superPlayersDoc.players.push(...newPlayers);
        await superPlayersDoc.save();

        console.log(`Added ${newPlayers.length} new Super Players to existing collection`);

        return res.json({
          success: true,
          message: `Added ${newPlayers.length} new Super Players`,
          superPlayersDoc,
          addedPlayers: newPlayers.length,
          totalSuperPlayers: superPlayersDoc.players.length
        });
      } else {
        console.log("No new players to add (all were duplicates)");

        return res.json({
          success: true,
          message: "All players were already in Super Players collection",
          superPlayersDoc,
          addedPlayers: 0,
          totalSuperPlayers: superPlayersDoc.players.length
        });
      }
    } else {
      // Create new Super Players document
      console.log("Creating new Super Players document...");

      // Ensure playerId is properly converted to ObjectId
      const processedPlayers = players.map(player => ({
        ...player,
        playerId: mongoose.Types.ObjectId.isValid(player.playerId)
          ? new mongoose.Types.ObjectId(player.playerId)
          : player.playerId
      }));

      const newSuperPlayersDoc = new SuperPlayers({
        tournamentId,
        players: processedPlayers
      });

      await newSuperPlayersDoc.save();

      console.log(`Created new Super Players document with ${players.length} players`);

      return res.json({
        success: true,
        message: `Created Super Players collection with ${players.length} players`,
        superPlayersDoc: newSuperPlayersDoc,
        addedPlayers: players.length,
        totalSuperPlayers: players.length
      });
    }

  } catch (error) {
    console.error("Error saving Super Players:", error);
    res.status(500).json({
      success: false,
      message: "Failed to save Super Players",
      error: error.message
    });
  }
};

// ===================== SUPER PLAYERS KNOCKOUT SYSTEM =====================

// Generate Knockout Matches for Super Players
exports.generateKnockoutMatches = async (req, res) => {
  try {
    const { tournamentId, courtNumber, matchStartTime, intervalMinutes } = req.body;

    // Get Super Players for this tournament
    const superPlayersDoc = await SuperPlayers.findOne({ tournamentId }).populate('players.playerId', 'name');

    if (!superPlayersDoc || !superPlayersDoc.players.length) {
      return res.status(404).json({
        success: false,
        message: "No Super Players found for this tournament"
      });
    }

    const players = superPlayersDoc.players;
    const playerCount = players.length;

    // 🎯 GET TOURNAMENT MATCH FORMAT for SuperMatch inheritance!
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }

    // Get tournament's match format (inherit from tournament settings!)
    const tournamentMatchFormat = tournament.matchFormat || {
      totalSets: 5,
      setsToWin: 3,
      maxSets: 5,
      totalGames: 5,
      gamesToWin: 3,
      maxGames: 5,
      pointsToWinGame: 11,
      marginToWin: 2,
      deuceRule: true,
      maxPointsPerGame: null,
      serviceRule: {
        pointsPerService: 2,
        deuceServicePoints: 1
      }
    };
    console.log("🎯 SuperMatch inheriting tournament match format:", tournamentMatchFormat);

    // Delete existing knockout matches for this tournament
    await SuperMatch.deleteMany({ tournamentId });

    // Generate bracket based on player count
    const bracket = generateBracketStructure(playerCount);

    const matches = [];
    let matchIdCounter = 1;
    let currentTime = new Date(matchStartTime);

    // Generate matches for each round
    for (const round of bracket.rounds) {

      for (let i = 0; i < round.matchCount; i++) {
        const matchId = `${tournamentId}_${round.abbreviation}_${i + 1}`;

        // For first round, assign actual players; for later rounds, TBD
        let player1, player2;

        if (round.roundNumber === 1) {
          // First round - assign actual players
          const player1Index = i * 2;
          const player2Index = i * 2 + 1;

          if (player1Index < players.length && player2Index < players.length) {
            player1 = {
              playerId: players[player1Index].playerId,
              playerName: players[player1Index].playerName,
              seed: player1Index + 1
            };
            player2 = {
              playerId: players[player2Index].playerId,
              playerName: players[player2Index].playerName,
              seed: player2Index + 1
            };
          } else {
            // Handle bye (odd number of players)
            player1 = {
              playerId: players[player1Index].playerId,
              playerName: players[player1Index].playerName,
              seed: player1Index + 1
            };
            player2 = {
              playerId: null,
              playerName: "BYE",
              seed: null
            };
          }
        } else {
          // Later rounds - TBD players
          player1 = {
            playerId: null,
            playerName: "TBD",
            seed: null
          };
          player2 = {
            playerId: null,
            playerName: "TBD",
            seed: null
          };
        }

        // Calculate nextMatchId for bracket progression
        let nextMatchId = null;
        if (round.roundNumber < bracket.rounds.length) {
          // Not the final round - calculate next match
          const nextRound = bracket.rounds[round.roundNumber]; // Next round (0-indexed)
          const nextMatchNumber = Math.floor(i / 2) + 1;
          nextMatchId = `${tournamentId}_${nextRound.abbreviation}_${nextMatchNumber}`;
        }

        const match = new SuperMatch({
          tournamentId,
          matchId,
          round: round.name,
          roundNumber: round.roundNumber,
          matchNumber: i + 1,
          player1,
          player2,
          courtNumber,
          matchStartTime: new Date(currentTime),
          status: "SCHEDULED",
          nextMatchId: nextMatchId,
          // 🎯 INHERIT TOURNAMENT MATCH FORMAT - NO MORE HARDCODED VALUES!
          matchFormat: tournamentMatchFormat
        });

        matches.push(match);

        // Increment time for next match
        currentTime = new Date(currentTime.getTime() + intervalMinutes * 60000);
      }
    }

    // Save all matches
    await SuperMatch.insertMany(matches);

    res.json({
      success: true,
      message: `Generated ${matches.length} knockout matches`,
      matchesCreated: matches.length,
      bracket: bracket,
      matches: matches.map(m => ({
        matchId: m.matchId,
        round: m.round,
        player1: m.player1.playerName,
        player2: m.player2.playerName,
        matchStartTime: m.matchStartTime
      }))
    });

  } catch (error) {
    console.error("Error generating knockout matches:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate knockout matches",
      error: error.message
    });
  }
};

// Helper function to generate bracket structure based on player count
function generateBracketStructure(playerCount) {
  let rounds = [];
  let currentPlayers = playerCount;
  let roundNumber = 1;

  // Determine the starting round based on player count
  if (playerCount <= 2) {
    rounds.push({
      name: "final",
      abbreviation: "F",
      roundNumber: roundNumber++,
      matchCount: 1
    });
  } else if (playerCount <= 4) {
    rounds.push({
      name: "semi-final",
      abbreviation: "SF",
      roundNumber: roundNumber++,
      matchCount: 2
    });
    rounds.push({
      name: "final",
      abbreviation: "F",
      roundNumber: roundNumber++,
      matchCount: 1
    });
  } else if (playerCount <= 8) {
    rounds.push({
      name: "quarter-final",
      abbreviation: "QF",
      roundNumber: roundNumber++,
      matchCount: 4
    });
    rounds.push({
      name: "semi-final",
      abbreviation: "SF",
      roundNumber: roundNumber++,
      matchCount: 2
    });
    rounds.push({
      name: "final",
      abbreviation: "F",
      roundNumber: roundNumber++,
      matchCount: 1
    });
  } else {
    // For more than 8 players, start with pre-quarters
    let matchesInFirstRound = Math.ceil(currentPlayers / 2);

    rounds.push({
      name: "pre-quarter",
      abbreviation: "PQ",
      roundNumber: roundNumber++,
      matchCount: matchesInFirstRound
    });

    currentPlayers = matchesInFirstRound;

    // Add subsequent rounds
    while (currentPlayers > 1) {
      let matchCount = Math.ceil(currentPlayers / 2);

      if (currentPlayers <= 8 && currentPlayers > 4) {
        rounds.push({
          name: "quarter-final",
          abbreviation: "QF",
          roundNumber: roundNumber++,
          matchCount: matchCount
        });
      } else if (currentPlayers <= 4 && currentPlayers > 2) {
        rounds.push({
          name: "semi-final",
          abbreviation: "SF",
          roundNumber: roundNumber++,
          matchCount: matchCount
        });
      } else if (currentPlayers === 2) {
        rounds.push({
          name: "final",
          abbreviation: "F",
          roundNumber: roundNumber++,
          matchCount: 1
        });
      }

      currentPlayers = matchCount;
    }
  }

  return {
    totalPlayers: playerCount,
    totalRounds: rounds.length,
    rounds: rounds
  };
}

// Get Knockout Matches for a tournament
exports.getKnockoutMatches = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    const matches = await SuperMatch.find({ tournamentId })
      .populate('player1.playerId', 'name profileImage')
      .populate('player2.playerId', 'name profileImage')
      .populate('winner.playerId', 'name profileImage')
      .sort({ roundNumber: 1, matchNumber: 1 });

    // Group matches by round
    const matchesByRound = {};
    matches.forEach(match => {
      if (!matchesByRound[match.round]) {
        matchesByRound[match.round] = [];
      }
      matchesByRound[match.round].push(match);
    });

    res.json({
      success: true,
      totalMatches: matches.length,
      matches: matches,
      matchesByRound: matchesByRound
    });

  } catch (error) {
    console.error("Error fetching knockout matches:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch knockout matches",
      error: error.message
    });
  }
};


// Update Match Result
exports.updateKnockoutMatchResult = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { winnerId, winnerName, loserData, score, status } = req.body;

    // Validate required parameters
    if (!matchId) {
      return res.status(400).json({
        success: false,
        message: "Match ID is required"
      });
    }

    const match = await SuperMatch.findOne({ matchId });
    if (!match) {
      return res.status(404).json({
        success: false,
        message: "Match not found"
      });
    }

    // Validate that the match is not already completed
    if (match.status === "COMPLETED" && match.winner?.playerId) {
      return res.status(400).json({
        success: false,
        message: "Match is already completed",
        currentWinner: match.winner.playerName
      });
    }

    // Validate winner is one of the match participants
    if (winnerId && winnerName) {
      const isValidWinner =
        (match.player1.playerId && match.player1.playerId.toString() === winnerId.toString()) ||
        (match.player2.playerId && match.player2.playerId.toString() === winnerId.toString());

      if (!isValidWinner) {
        return res.status(400).json({
          success: false,
          message: "Winner must be one of the match participants",
          participants: [match.player1.playerName, match.player2.playerName]
        });
      }
    }

    // Update match result
    match.winner = {
      playerId: winnerId,
      playerName: winnerName
    };
    match.loser = loserData;
    match.score = score;

    // Ensure status is properly set to "COMPLETED" when winner is determined
    if (winnerId && winnerName) {
      match.status = "COMPLETED";
    } else {
      match.status = status || "IN_PROGRESS";
    }

    // Calculate comprehensive statistics if match is completed
    if (match.status === "COMPLETED" && score && score.setScores) {
      const statistics = calculateMatchStatistics(match, score);
      match.statistics = statistics;
    }

    await match.save();

    console.log(`SuperMatch ${matchId} updated: Status=${match.status}, Winner=${winnerName}`);

    // Progress winner to next round if applicable
    if (match.status === "COMPLETED") {
      try {
        await progressWinnerToNextRound(match);
      } catch (progressError) {
        console.error("Error progressing winner:", progressError);
        // Don't fail the match update if progression fails
      }
    }

    res.json({
      success: true,
      message: "Match result updated successfully",
      match: match
    });

  } catch (error) {
    console.error("Error updating match result:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update match result",
      error: error.message
    });
  }
};

// Helper function to progress winner to next round
async function progressWinnerToNextRound(completedMatch, session = null) {
  // Check if this match has a next match to progress to
  if (!completedMatch.nextMatchId) {
    console.log(`Match ${completedMatch.matchId} is the final match - no progression needed`);
    return;
  }

  // Find the next match using the nextMatchId
  const query = {
    matchId: completedMatch.nextMatchId,
    tournamentId: completedMatch.tournamentId
  };

  // Try to find the next match in both SuperMatch and DirectKnockoutMatch collections
  let nextMatch = session ?
    await SuperMatch.findOne(query).session(session) :
    await SuperMatch.findOne(query);

  // If not found in SuperMatch, try DirectKnockoutMatch
  if (!nextMatch) {
    nextMatch = session ?
      await DirectKnockoutMatch.findOne(query).session(session) :
      await DirectKnockoutMatch.findOne(query);
  }

  if (!nextMatch) {
    console.error(`Next match ${completedMatch.nextMatchId} not found for match ${completedMatch.matchId} in any collection (SuperMatch or DirectKnockoutMatch)`);
    return;
  }

  // Determine if winner goes to player1 or player2 position based on match number
  const isPlayer1Position = (completedMatch.matchNumber - 1) % 2 === 0;

  // 🔥 DYNAMIC SCHEMA DETECTION FOR WINNER PROGRESSION!
  let winnerData;
  const isSuperMatch = completedMatch.constructor?.modelName === 'SuperMatch';
  const isDirectKnockout = completedMatch.constructor?.modelName === 'DirectKnockoutMatch';

  if (isSuperMatch) {
    // SuperMatch stores winner directly
    winnerData = completedMatch.winner;
  } else if (isDirectKnockout) {
    // DirectKnockoutMatch stores winner in result object (CRITICAL FIX!)
    winnerData = completedMatch.result?.winner;
  } else {
    // Fallback for other match types
    winnerData = completedMatch.winner || completedMatch.result?.winner;
  }

  if (!winnerData) {
    console.error(`No winner data found in completed match ${completedMatch.matchId}. Schema: ${completedMatch.constructor?.modelName}`);
    return;
  }

  const winnerInfo = {
    playerId: winnerData.playerId,
    playerName: winnerData.playerName,
    seed: winnerData.playerId === completedMatch.player1.playerId ?
      completedMatch.player1.seed : completedMatch.player2.seed
  };

  if (isPlayer1Position) {
    nextMatch.player1 = winnerInfo;
  } else {
    nextMatch.player2 = winnerInfo;
  }

  if (session) {
    await nextMatch.save({ session });
  } else {
    await nextMatch.save();
  }

  console.log(`Winner ${winnerData.playerName} advanced from ${completedMatch.matchId} to ${nextMatch.matchId}`);
}

// Export the function so it can be used by other controllers
exports.progressWinnerToNextRound = progressWinnerToNextRound;
exports.calculateMatchStatistics = calculateMatchStatistics;

// Helper function to calculate comprehensive match statistics
function calculateMatchStatistics(match, score) {
  const statistics = {
    player1Stats: {
      setsWon: 0,
      setsLost: 0,
      gamesWon: 0,
      gamesLost: 0,
      totalPoints: 0,
      totalPointsAgainst: 0,
      matchesWon: 0,
      matchesLost: 0,
      matchesPlayed: 1
    },
    player2Stats: {
      setsWon: 0,
      setsLost: 0,
      gamesWon: 0,
      gamesLost: 0,
      totalPoints: 0,
      totalPointsAgainst: 0,
      matchesWon: 0,
      matchesLost: 0,
      matchesPlayed: 1
    }
  };

  // Calculate sets won/lost
  statistics.player1Stats.setsWon = score.player1Sets || 0;
  statistics.player1Stats.setsLost = score.player2Sets || 0;
  statistics.player2Stats.setsWon = score.player2Sets || 0;
  statistics.player2Stats.setsLost = score.player1Sets || 0;

  // Calculate games won/lost and points from individual sets
  if (score.setScores && Array.isArray(score.setScores)) {
    score.setScores.forEach(set => {
      const p1Score = set.player1Score || 0;
      const p2Score = set.player2Score || 0;

      // Add to total points
      statistics.player1Stats.totalPoints += p1Score;
      statistics.player1Stats.totalPointsAgainst += p2Score;
      statistics.player2Stats.totalPoints += p2Score;
      statistics.player2Stats.totalPointsAgainst += p1Score;

      // Count games won (each set is essentially a game in table tennis)
      if (p1Score > p2Score) {
        statistics.player1Stats.gamesWon += 1;
        statistics.player2Stats.gamesLost += 1;
      } else if (p2Score > p1Score) {
        statistics.player2Stats.gamesWon += 1;
        statistics.player1Stats.gamesLost += 1;
      }
    });
  }

  // Determine match winner/loser
  const isPlayer1Winner = match.winner && match.winner.playerId &&
    match.winner.playerId.toString() === match.player1.playerId.toString();

  if (isPlayer1Winner) {
    statistics.player1Stats.matchesWon = 1;
    statistics.player2Stats.matchesLost = 1;
  } else {
    statistics.player2Stats.matchesWon = 1;
    statistics.player1Stats.matchesLost = 1;
  }

  return statistics;
}

// Get tournament leaderboard/statistics
exports.getTournamentLeaderboard = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    // Get all completed SuperMatches for this tournament
    const matches = await SuperMatch.find({
      tournamentId,
      status: "COMPLETED"
    })
      .populate('player1.playerId', 'name profileImage')
      .populate('player2.playerId', 'name profileImage')
      .sort({ roundNumber: 1, matchNumber: 1 });

    if (!matches || matches.length === 0) {
      return res.json({
        success: true,
        leaderboard: [],
        message: "No completed matches found"
      });
    }

    // Aggregate statistics by player
    const playerStats = {};

    matches.forEach(match => {
      if (match.statistics) {
        // Process Player 1 stats
        const p1Id = match.player1.playerId._id.toString();
        if (!playerStats[p1Id]) {
          playerStats[p1Id] = {
            playerId: p1Id,
            playerName: match.player1.playerName,
            playerInfo: match.player1.playerId,
            setsWon: 0,
            setsLost: 0,
            gamesWon: 0,
            gamesLost: 0,
            totalPoints: 0,
            totalPointsAgainst: 0,
            matchesWon: 0,
            matchesLost: 0,
            matchesPlayed: 0
          };
        }

        // Add Player 1 statistics
        const p1Stats = match.statistics.player1Stats;
        playerStats[p1Id].setsWon += p1Stats.setsWon || 0;
        playerStats[p1Id].setsLost += p1Stats.setsLost || 0;
        playerStats[p1Id].gamesWon += p1Stats.gamesWon || 0;
        playerStats[p1Id].gamesLost += p1Stats.gamesLost || 0;
        playerStats[p1Id].totalPoints += p1Stats.totalPoints || 0;
        playerStats[p1Id].totalPointsAgainst += p1Stats.totalPointsAgainst || 0;
        playerStats[p1Id].matchesWon += p1Stats.matchesWon || 0;
        playerStats[p1Id].matchesLost += p1Stats.matchesLost || 0;
        playerStats[p1Id].matchesPlayed += p1Stats.matchesPlayed || 0;

        // Process Player 2 stats
        const p2Id = match.player2.playerId._id.toString();
        if (!playerStats[p2Id]) {
          playerStats[p2Id] = {
            playerId: p2Id,
            playerName: match.player2.playerName,
            playerInfo: match.player2.playerId,
            setsWon: 0,
            setsLost: 0,
            gamesWon: 0,
            gamesLost: 0,
            totalPoints: 0,
            totalPointsAgainst: 0,
            matchesWon: 0,
            matchesLost: 0,
            matchesPlayed: 0
          };
        }

        // Add Player 2 statistics
        const p2Stats = match.statistics.player2Stats;
        playerStats[p2Id].setsWon += p2Stats.setsWon || 0;
        playerStats[p2Id].setsLost += p2Stats.setsLost || 0;
        playerStats[p2Id].gamesWon += p2Stats.gamesWon || 0;
        playerStats[p2Id].gamesLost += p2Stats.gamesLost || 0;
        playerStats[p2Id].totalPoints += p2Stats.totalPoints || 0;
        playerStats[p2Id].totalPointsAgainst += p2Stats.totalPointsAgainst || 0;
        playerStats[p2Id].matchesWon += p2Stats.matchesWon || 0;
        playerStats[p2Id].matchesLost += p2Stats.matchesLost || 0;
        playerStats[p2Id].matchesPlayed += p2Stats.matchesPlayed || 0;
      }
    });

    // Convert to array and calculate additional metrics
    const leaderboard = Object.values(playerStats).map(player => {
      const winPercentage = player.matchesPlayed > 0 ?
        ((player.matchesWon / player.matchesPlayed) * 100).toFixed(2) : 0;

      const setWinPercentage = (player.setsWon + player.setsLost) > 0 ?
        ((player.setsWon / (player.setsWon + player.setsLost)) * 100).toFixed(2) : 0;

      const pointDifference = player.totalPoints - player.totalPointsAgainst;

      return {
        ...player,
        winPercentage: parseFloat(winPercentage),
        setWinPercentage: parseFloat(setWinPercentage),
        pointDifference: pointDifference,
        averagePointsPerMatch: player.matchesPlayed > 0 ?
          (player.totalPoints / player.matchesPlayed).toFixed(2) : 0
      };
    });

    // Sort by win percentage, then by point difference
    leaderboard.sort((a, b) => {
      if (b.winPercentage !== a.winPercentage) {
        return b.winPercentage - a.winPercentage;
      }
      return b.pointDifference - a.pointDifference;
    });

    // Add ranking
    leaderboard.forEach((player, index) => {
      player.rank = index + 1;
    });

    res.json({
      success: true,
      leaderboard: leaderboard,
      totalPlayers: leaderboard.length,
      totalMatches: matches.length
    });

  } catch (error) {
    console.error("Error fetching tournament leaderboard:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch tournament leaderboard",
      error: error.message
    });
  }
};

// Get comprehensive tournament statistics across all stages (Group, Round 2, Knockout)
exports.getComprehensiveTournamentStats = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    // Initialize player stats aggregator
    const playerStats = {};

    // Helper function to add player stats
    const addPlayerStats = (playerId, playerName, playerInfo, stats) => {
      if (!playerStats[playerId]) {
        playerStats[playerId] = {
          playerId,
          playerName,
          playerInfo,
          setsWon: 0,
          setsLost: 0,
          gamesWon: 0,
          gamesLost: 0,
          totalPoints: 0,
          totalPointsAgainst: 0,
          matchesWon: 0,
          matchesLost: 0,
          matchesPlayed: 0,
          stagesPlayed: []
        };
      }

      playerStats[playerId].setsWon += stats.setsWon || 0;
      playerStats[playerId].setsLost += stats.setsLost || 0;
      playerStats[playerId].gamesWon += stats.gamesWon || 0;
      playerStats[playerId].gamesLost += stats.gamesLost || 0;
      playerStats[playerId].totalPoints += stats.totalPoints || 0;
      playerStats[playerId].totalPointsAgainst += stats.totalPointsAgainst || 0;
      playerStats[playerId].matchesWon += stats.matchesWon || 0;
      playerStats[playerId].matchesLost += stats.matchesLost || 0;
      playerStats[playerId].matchesPlayed += stats.matchesPlayed || 0;
    };

    // Get Knockout stage matches (SuperMatch)
    const knockoutMatches = await SuperMatch.find({
      tournamentId,
      status: "COMPLETED"
    })
      .populate('player1.playerId', 'name profileImage')
      .populate('player2.playerId', 'name profileImage');

    knockoutMatches.forEach(match => {
      if (match.statistics) {
        if (match.player1?.playerId) {
          addPlayerStats(
            match.player1.playerId._id.toString(),
            match.player1.playerName,
            match.player1.playerId,
            match.statistics.player1Stats
          );
          if (!playerStats[match.player1.playerId._id.toString()].stagesPlayed.includes('Knockout')) {
            playerStats[match.player1.playerId._id.toString()].stagesPlayed.push('Knockout');
          }
        }

        if (match.player2?.playerId) {
          addPlayerStats(
            match.player2.playerId._id.toString(),
            match.player2.playerName,
            match.player2.playerId,
            match.statistics.player2Stats
          );
          if (!playerStats[match.player2.playerId._id.toString()].stagesPlayed.includes('Knockout')) {
            playerStats[match.player2.playerId._id.toString()].stagesPlayed.push('Knockout');
          }
        }
      }
    });

    // Calculate comprehensive metrics
    const leaderboard = Object.values(playerStats).map(player => {
      const winPercentage = player.matchesPlayed > 0 ?
        ((player.matchesWon / player.matchesPlayed) * 100).toFixed(2) : 0;

      const setWinPercentage = (player.setsWon + player.setsLost) > 0 ?
        ((player.setsWon / (player.setsWon + player.setsLost)) * 100).toFixed(2) : 0;

      const pointDifference = player.totalPoints - player.totalPointsAgainst;

      return {
        ...player,
        winPercentage: parseFloat(winPercentage),
        setWinPercentage: parseFloat(setWinPercentage),
        pointDifference: pointDifference,
        averagePointsPerMatch: player.matchesPlayed > 0 ?
          parseFloat((player.totalPoints / player.matchesPlayed).toFixed(2)) : 0,
        stagesPlayedCount: player.stagesPlayed.length
      };
    });

    // Sort by multiple criteria: win percentage, point difference
    leaderboard.sort((a, b) => {
      // First by win percentage
      if (b.winPercentage !== a.winPercentage) {
        return b.winPercentage - a.winPercentage;
      }
      // Then by point difference
      return b.pointDifference - a.pointDifference;
    });

    // Add ranking
    leaderboard.forEach((player, index) => {
      player.rank = index + 1;
    });

    res.json({
      success: true,
      leaderboard: leaderboard,
      totalPlayers: leaderboard.length,
      summary: {
        totalKnockoutMatches: knockoutMatches.length,
        playersInKnockout: knockoutMatches.length > 0 ?
          new Set([...knockoutMatches.map(m => m.player1.playerId._id.toString()),
          ...knockoutMatches.map(m => m.player2.playerId._id.toString())]).size : 0
      }
    });

  } catch (error) {
    console.error("Error fetching comprehensive tournament statistics:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch comprehensive tournament statistics",
      error: error.message
    });
  }
};

// ===================== DIRECT KNOCKOUT SYSTEM =====================

// Validate players for direct knockout
exports.validateDirectKnockoutPlayers = async (req, res) => {
  try {
    const { tournamentId, selectedPlayers } = req.body;

    // Validate tournament exists
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }

    // Validate player count
    if (!selectedPlayers || selectedPlayers.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No players selected"
      });
    }

    // Check if count is power of 2
    const count = selectedPlayers.length;
    const isPowerOf2 = count > 0 && (count & (count - 1)) === 0;
    const validSizes = [4, 8, 16, 32];

    if (!isPowerOf2 || !validSizes.includes(count)) {
      return res.status(400).json({
        success: false,
        message: `Player count must be a power of 2. Valid sizes: ${validSizes.join(", ")}. Current count: ${count}`
      });
    }

    // Validate all players exist
    const playerIds = selectedPlayers.map(p => p.playerId).filter(Boolean);
    const existingPlayers = await User.find({ _id: { $in: playerIds } });

    if (existingPlayers.length !== playerIds.length) {
      return res.status(400).json({
        success: false,
        message: "Some selected players do not exist"
      });
    }

    res.json({
      success: true,
      message: "Players validated successfully",
      playerCount: count,
      rounds: Math.log2(count),
      totalMatches: count - 1
    });

  } catch (error) {
    console.error("Error validating direct knockout players:", error);
    res.status(500).json({
      success: false,
      message: "Failed to validate players",
      error: error.message
    });
  }
};

// Create direct knockout matches
exports.createDirectKnockoutMatches = async (req, res) => {
  try {
    const { tournamentId, selectedPlayers, schedule } = req.body;

    // Validate input
    if (!tournamentId || !selectedPlayers || !schedule) {
      return res.status(400).json({
        success: false,
        message: "Missing required data: tournamentId, selectedPlayers, or schedule"
      });
    }

    const { startDate, startTime, courtNumber, intervalMinutes } = schedule;

    // Validate tournament exists
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }

    // Create bracket structure
    const playerCount = selectedPlayers.length;
    const rounds = Math.log2(playerCount);
    const totalMatches = playerCount - 1;

    // Shuffle players for random first round matchups
    const shuffledPlayers = [...selectedPlayers].sort(() => Math.random() - 0.5);

    const matches = [];
    let matchCounter = 1;

    // Create first round matches
    for (let i = 0; i < shuffledPlayers.length; i += 2) {
      const player1 = shuffledPlayers[i];
      const player2 = shuffledPlayers[i + 1];

      // Calculate match start time
      const matchDateTime = new Date(`${startDate}T${startTime}`);
      matchDateTime.setMinutes(matchDateTime.getMinutes() + (matchCounter - 1) * intervalMinutes);

      const match = {
        tournamentId,
        matchId: `DK-${tournamentId}-${matchCounter}`,
        round: getRoundName(playerCount, 1),
        roundNumber: 1,
        matchNumber: matchCounter,
        player1: {
          playerId: player1.playerId,
          playerName: player1.userName
        },
        player2: {
          playerId: player2.playerId,
          playerName: player2.userName
        },
        courtNumber: courtNumber.toString(),
        matchStartTime: matchDateTime,
        bracketPosition: `R1-M${matchCounter}`,
        status: "SCHEDULED"
      };

      matches.push(match);
      matchCounter++;
    }

    // Create placeholder matches for subsequent rounds
    let currentRoundMatches = matches.length;
    for (let round = 2; round <= rounds; round++) {
      const nextRoundMatches = currentRoundMatches / 2;

      for (let i = 1; i <= nextRoundMatches; i++) {
        const matchDateTime = new Date(`${startDate}T${startTime}`);
        matchDateTime.setMinutes(matchDateTime.getMinutes() + (matchCounter - 1) * intervalMinutes);

        const match = {
          tournamentId,
          matchId: `DK-${tournamentId}-${matchCounter}`,
          round: getRoundName(playerCount, round),
          roundNumber: round,
          matchNumber: i,
          player1: {
            playerId: null,
            playerName: "TBD"
          },
          player2: {
            playerId: null,
            playerName: "TBD"
          },
          courtNumber: courtNumber.toString(),
          matchStartTime: matchDateTime,
          bracketPosition: `R${round}-M${i}`,
          status: "SCHEDULED"
        };

        matches.push(match);
        matchCounter++;
      }

      currentRoundMatches = nextRoundMatches;
    }

    // Save matches to database
    const createdMatches = await DirectKnockoutMatch.insertMany(matches);

    // Update tournament status
    await Tournament.findByIdAndUpdate(tournamentId, {
      $set: {
        'stageConfig.directKnockout.status': 'matches_created',
        'stageConfig.directKnockout.createdAt': new Date()
      }
    });

    res.json({
      success: true,
      message: "Direct knockout matches created successfully",
      bracket: {
        totalMatches: createdMatches.length,
        rounds: rounds,
        playerCount: playerCount
      },
      matches: createdMatches
    });

  } catch (error) {
    console.error("Error creating direct knockout matches:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create direct knockout matches",
      error: error.message
    });
  }
};

// Get direct knockout matches
exports.getDirectKnockoutMatches = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    const matches = await DirectKnockoutMatch.find({ tournamentId })
      .populate('player1.playerId', 'name profileImage')
      .populate('player2.playerId', 'name profileImage')
      .sort({ roundNumber: 1, matchNumber: 1 });

    res.json({
      success: true,
      matches: matches
    });

  } catch (error) {
    console.error("Error fetching direct knockout matches:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch direct knockout matches",
      error: error.message
    });
  }
};

// Helper function to get round names
function getRoundName(playerCount, roundNumber) {
  const rounds = Math.log2(playerCount);

  if (roundNumber === rounds) return "final";
  if (roundNumber === rounds - 1) return "semi-final";
  if (roundNumber === rounds - 2) return "quarter-final";
  if (roundNumber === rounds - 3) return "round-of-8";
  if (roundNumber === rounds - 4) return "round-of-16";
  if (roundNumber === rounds - 5) return "round-of-32";

  return `round-${roundNumber}`;
}

// Get groups without matches
exports.getGroupsWithoutMatches = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    if (!tournamentId) {
      return res.status(400).json({
        success: false,
        message: "Tournament ID is required"
      });
    }

    // Import models
    const BookingGroup = require("../Modal/bookinggroup");
    const Match = require("../Modal/Tournnamentmatch");

    // Get all groups for the tournament
    const allGroups = await BookingGroup.find({ tournamentId })
      .populate({
        path: "players",
        populate: {
          path: "userId",
          select: "name profileImage",
        },
      });

    // Get all matches for the tournament
    const allMatches = await Match.find({ tournamentId }).select('groupId');

    // Extract unique group IDs that have matches
    const groupIdsWithMatches = [...new Set(allMatches.map(match => match.groupId.toString()))];

    // Filter groups that don't have any matches
    const groupsWithoutMatches = allGroups.filter(group =>
      !groupIdsWithMatches.includes(group._id.toString())
    );

    res.status(200).json({
      success: true,
      message: "Groups without matches retrieved successfully",
      data: {
        groupsWithoutMatches,
        count: groupsWithoutMatches.length
      }
    });

  } catch (error) {
    console.error("Error fetching groups without matches:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch groups without matches",
      error: error.message
    });
  }
};
