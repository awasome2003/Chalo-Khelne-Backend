const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const Match = require("../Modal/Tournnamentmatch");
const tournamentController = require("../controllers/tournamentController");
const bookingController = require("../controllers/BookingController");
const bookingGroupController = require("../controllers/booking groupcontroller");
const matchController = require("../controllers/matchController");
const knockoutController = require("../controllers/knockoutController");
const groupStageScoreboardController = require("../controllers/groupStageScoreboardController");
const directKnockoutController = require("../controllers/directKnockoutController");
const { uploadMiddleware } = require("../middleware/uploads");

const {
  createTopPlayerGroup,
  getTopPlayerGroups,
} = require("../controllers/topPlayerGroupsController");
const KnockoutMatch = require("../Modal/semifinal");
const teamKnockoutController = require("../controllers/teamKnockoutController");
const tournamentLeaderboardController = require("../controllers/tournamentLeaderboardController");

//*Create Tournament*//

router.post(
  "/createTournament",
  uploadMiddleware.single("tournamentLogo"),
  tournamentController.createTournament
);
router.get("/", tournamentController.getAllTournaments);
router.get("/manager/:managerId", tournamentController.getTournamentsByManager);
// 🚀 New Corporate specific routes
router.get("/corporate/:corporateId", tournamentController.getTournamentsByCorporate);
router.put("/:tournamentId/whitelist", tournamentController.updateTournamentWhitelist);

router.put("/edit/:id", uploadMiddleware.single("tournamentLogo"), tournamentController.editTournament);
router.delete("/:id", tournamentController.deleteTournament);

//*ROUND 2 PROGRESSION ROUTES*//
router.get("/round2/status/:tournamentId", tournamentController.getRound2Status);
router.post("/round2/initiate", tournamentController.initiateRound2);
router.post("/round2/create-groups", tournamentController.createRound2Groups);
router.get("/round2/groups/:tournamentId", tournamentController.getRound2Groups);
router.post("/round2/reset", tournamentController.resetRound2Progress);
router.post("/superplayers/identify", tournamentController.identifySuperPlayers);
router.get("/superplayers/:tournamentId", tournamentController.getSuperPlayers);
router.post("/cleanup/superplayers-from-topplayers/:tournamentId", tournamentController.cleanupSuperPlayersFromTopPlayers);
router.post("/cleanup/aggressive-superplayers/:tournamentId", tournamentController.aggressiveCleanupSuperPlayers);

//*SUPER PLAYERS KNOCKOUT ROUTES*//
router.post("/knockout/generate", tournamentController.generateKnockoutMatches);
router.get("/knockout/matches/:tournamentId", tournamentController.getKnockoutMatches);
router.put("/knockout/match/:matchId/result", tournamentController.updateKnockoutMatchResult);
router.get("/knockout/leaderboard/:tournamentId", tournamentController.getTournamentLeaderboard);
router.get("/comprehensive-stats/:tournamentId", tournamentController.getComprehensiveTournamentStats);

// Tournament Leaderboard routes (mobile client)
router.get("/leaderboard/all", tournamentLeaderboardController.getAllTournamentsWithLeaderboard);
router.get("/leaderboard/:tournamentId/players", tournamentLeaderboardController.getGroupStagePlayersLeaderboard);
router.get("/leaderboard/:tournamentId/teams", tournamentLeaderboardController.getKnockoutTeamsLeaderboard);



// Validate player selection for Direct Knockout (power-of-2 check)
router.post(
  "/direct-knockout/validate-players",
  directKnockoutController.validatePlayerSelection
);

// Create Direct Knockout matches with bracket generation
router.post(
  "/direct-knockout/create-matches",
  directKnockoutController.createDirectKnockoutMatches
);

// Get all Direct Knockout matches for a tournament
router.get(
  "/direct-knockout/:tournamentId/matches",
  directKnockoutController.getDirectKnockoutMatches
);

// Progress winner to next match in bracket
router.post(
  "/direct-knockout/matches/:matchId/progress-winner",
  directKnockoutController.progressWinnerToNextMatch
);

// Standalone mode — no group stage needed
router.post(
  "/direct-knockout/standalone/validate",
  directKnockoutController.validateStandalonePlayers
);
router.post(
  "/direct-knockout/standalone/create",
  directKnockoutController.createStandaloneKnockout
);

// Live scoring for Direct Knockout
router.post(
  "/direct-knockout/matches/:matchId/complete-game",
  directKnockoutController.completeGame
);

// Give BYE to a player in a match
router.post(
  "/direct-knockout/matches/:matchId/bye",
  directKnockoutController.giveBye
);

// Bulk score upload for Direct Knockout
router.post(
  "/direct-knockout/bulk-upload-scores",
  directKnockoutController.bulkUploadScores
);

// Reset bracket
router.delete(
  "/direct-knockout/:tournamentId/reset",
  directKnockoutController.resetBracket
);

//*GROUP STAGE TOURNAMENT ROUTES*//
//*Registred Players*//

router.post("/bookings/create", bookingController.createBooking);
router.get("/bookings/check", bookingController.checkBooking);
router.get("/bookings/user/:userId", bookingController.getUserBookings);
router.get(
  "/bookings/tournament/:tournamentId",
  bookingController.getTournamentBookings
);


//*League Group*//

router.post("/bookinggroups/create", bookingGroupController.createBookingGroup);
router.get(
  "/bookinggroups/tournament/:tournamentId",
  bookingGroupController.getBookingGroups
);
router.put(
  "/bookinggroups/:groupId",
  bookingGroupController.updateBookingGroup
);
router.delete(
  "/bookinggroups/:groupId",
  bookingGroupController.deleteBookingGroup
);

// 🚀 Group-specific match format routes
router.get(
  "/bookinggroups/:groupId/match-format",
  bookingGroupController.getGroupMatchFormat
);
router.put(
  "/bookinggroups/:groupId/match-format",
  bookingGroupController.updateGroupMatchFormat
);

//*Matches*//

router.post("/matches/create", matchController.createMatches);
router.post("/matches/generate-group", matchController.generateGroupMatches);
router.post("/matches/transition-to-knockout", matchController.transitionToKnockout);

//*GROUP STAGE SCOREBOARD ROUTES (Must come before general match routes)*//

// Start match and initialize scoreboard
router.post("/matches/:matchId/start", groupStageScoreboardController.startMatch);

// Get live match state (for scoreboard UI)
router.get("/matches/:matchId/live-state", groupStageScoreboardController.getLiveMatchState);

// Get match scores (array format for compatibility)
router.get("/matches/:matchId/scores", groupStageScoreboardController.getMatchScores);

// Get single score (alternative endpoint)
router.get("/scores/:matchId", groupStageScoreboardController.getMatchScore);

// Update live score during game
router.put("/matches/:matchId/live-score", groupStageScoreboardController.updateLiveScore);

// Complete current game and progress match
router.post("/matches/:matchId/complete-game", groupStageScoreboardController.completeGame);

// Reset match (admin function)
router.post("/matches/:matchId/reset", groupStageScoreboardController.resetMatch);

// Get match statistics
router.get("/matches/:matchId/statistics", groupStageScoreboardController.getMatchStatistics);

// Sync live match data to Score model for points table compatibility
router.post("/matches/:matchId/sync-scores", groupStageScoreboardController.syncMatchScores);

// Bulk sync all tournament matches to Score model (for already played matches)
router.post("/:tournamentId/bulk-sync-scores", groupStageScoreboardController.bulkSyncTournamentScores);

// Bulk upload set scores for multiple matches at once
router.post("/matches/bulk-upload-scores", groupStageScoreboardController.bulkUploadScores);

// 🚀 VALIDATION ENDPOINT - Test game completion logic fix
router.get("/validate/game-completion-logic", groupStageScoreboardController.validateGameCompletionLogic);

// Group Standings
router.get("/standings/:tournamentId/:groupId", groupStageScoreboardController.getGroupStandings);

// DEBUG: Check tournament matches data
router.get("/:tournamentId/debug-matches", async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const Match = require("../Modal/Tournnamentmatch");

    const matches = await Match.find({ tournamentId });

    const debug = matches.map(match => ({
      id: match._id,
      status: match.status,
      player1: match.player1?.userName,
      player2: match.player2?.userName,
      setsCount: match.sets?.length || 0,
      setsData: match.sets?.map(set => ({
        status: set.status,
        gamesCount: set.games?.length || 0,
        completedGames: set.games?.filter(g => g.status === 'COMPLETED').length || 0
      }))
    }));

    res.json({
      tournamentId,
      totalMatches: matches.length,
      matches: debug
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// IMPORTANT: Score-related routes must come BEFORE the general /:tournamentId/:groupId route
// Points Table specific route - returns array of scores for frontend compatibility (duplicate removed - already defined above)

// General match routes (must come after specific routes)
router.get(
  "/matches/:tournamentId/:groupId",
  matchController.getMatchesByGroup
);
router.put("/matches/:matchId", matchController.updateMatch);
router.delete("/matches/:matchId", matchController.deleteMatch);

//* Match Configuration *//

// 🚀 Get available match format options (for UI dropdowns)
router.get("/match-format-options", tournamentController.getMatchFormatOptions);

// Get tournament match format configuration
router.get("/:tournamentId/match-format", tournamentController.getTournamentMatchFormat);

// Update tournament match format configuration
router.put("/:tournamentId/match-format", tournamentController.updateTournamentMatchFormat);

// Get specific match configuration (inherits from tournament)
router.get("/matches/:matchId/format", tournamentController.getMatchFormat);

// Update specific match configuration (override tournament defaults)
router.put("/matches/:matchId/format", tournamentController.updateMatchFormat);

//*Scores*//

router.post("/scores/:matchId", tournamentController.createScore);
router.get("/scores/:matchId", tournamentController.getScoreByMatchId);
router.put('/scores/:matchId', tournamentController.updateScoreByMatchId);
router.delete('/scores/:matchId', tournamentController.deleteScoreByMatchId);



router.get("/:id", tournamentController.getTournamentById);



// Example Express route
router.get("/referee/matches/:refereeId", async (req, res) => {
  const { refereeId } = req.params;
  try {
    const matches = await Match.find({ "referee.refereeId": refereeId });

    res.status(200).json({ matches });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});


router.post("/top-player-groups", createTopPlayerGroup);
router.get("/top-player-groups/:tournamentId", getTopPlayerGroups);

// Get super matches for a tournament
router.get("/super-matches/:tournamentId", tournamentController.getSuperPlayers);
router.post("/superplayers/save", tournamentController.saveSuperPlayers);


// routes/bookingRoutes.js (new controller bookingGroup)
router.post("/bookinggroups/create", bookingGroupController.createBookingGroup);
router.get(
  "/bookinggroups/tournament/:tournamentId",
  bookingGroupController.getBookingGroups
);

router.post("/topplayers/save", tournamentController.saveTopPlayers);

router.get("/topplayers/:tournamentId/:groupId", tournamentController.getTopPlayersByGroup);

router.get("/topplayers/:tournamentId", tournamentController.getTopPlayersByTournament);

//*TOURNAMENT PROGRESSION ROUTES*//

// Seeded Players Management
router.post("/:tournamentId/seeded-players", tournamentController.addSeededPlayers);

// Tournament Stage Progression
router.post("/:tournamentId/generate-qualifier-knockout", tournamentController.generateQualifierKnockout);
router.post("/:tournamentId/generate-main-knockout", tournamentController.generateMainKnockout);

// Tournament Status and Progression
router.get("/:tournamentId/progression", tournamentController.getTournamentProgression);

//*KNOCKOUT MATCH MANAGEMENT ROUTES*//

// Get knockout matches
router.get("/:tournamentId/knockout-matches", knockoutController.getKnockoutMatches);
router.get("/knockout-matches/:matchId", knockoutController.getKnockoutMatchById);

// Update match results
router.put("/knockout-matches/:matchId/result", knockoutController.updateKnockoutMatchResult);

// Generate next round
router.post("/:tournamentId/generate-next-round", knockoutController.generateNextRound);

// Get tournament bracket
router.get("/:tournamentId/bracket", knockoutController.getTournamentBracket);


// Update your knockout matches route
// Update your knockout matches route
router.post("/knockout-matches", async (req, res) => {
  try {
    const { tournamentId, matches } = req.body;

    // Validate input
    if (!tournamentId || !matches || !Array.isArray(matches)) {
      return res.status(400).json({
        success: false,
        message: "Invalid request data",
      });
    }

    // Format matches with required fields and proper date handling
    const formattedMatches = matches.map((match) => {
      // Parse the date and time strings correctly
      const [time, period] = match.time.split(" ");
      const [hours, minutes] = time.split(":");
      let hour = parseInt(hours);

      // Convert to 24-hour format if needed
      if (period === "PM" && hour !== 12) {
        hour += 12;
      } else if (period === "AM" && hour === 12) {
        hour = 0;
      }

      // Create a new Date object with the correct date and time
      const matchDateTime = new Date(match.date);
      matchDateTime.setHours(hour);
      matchDateTime.setMinutes(parseInt(minutes));
      matchDateTime.setSeconds(0);
      matchDateTime.setMilliseconds(0);

      // Create the formatted match object
      return {
        tournamentId,
        title: match.title,
        matchStage: match.matchStage || "knockout",
        date: match.date,
        time: match.time,
        selectedCourt: match.selectedCourt,
        teams: match.teams,
        status: "scheduled",
        roundNumber: match.roundNumber || 1,
        matchNumber: match.matchNumber,
        reminder: {
          isEnabled: true,
          reminderTime: matchDateTime, // Now using properly formatted Date object
        },
      };
    });

    // Debug log to verify the formatted matches
    console.log(
      "Formatted matches with correct dates:",
      formattedMatches.map((m) => ({
        ...m,
        reminder: {
          ...m.reminder,
          reminderTime: m.reminder.reminderTime.toISOString(),
        },
      }))
    );

    // Create matches
    const createdMatches = await KnockoutMatch.insertMany(formattedMatches);

    res.json({
      success: true,
      matches: createdMatches,
    });
  } catch (error) {
    console.error("Error creating knockout matches:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to create knockout matches",
      error: error.toString(),
    });
  }
});

// GET endpoint to fetch all knockout matches for a tournament
router.get("/knockout-matches/:tournamentId", async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const matches = await KnockoutMatch.find({ tournamentId }).sort({
      createdAt: -1,
    });

    res.json({
      success: true,
      matches,
    });
  } catch (error) {
    console.error("Error fetching knockout matches:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch knockout matches",
    });
  }
});

// Get groups without matches
router.get("/groups-without-matches/:tournamentId", tournamentController.getGroupsWithoutMatches);

// Get tournament logo
router.get("/:id/logo", tournamentController.getLogo);

// ================================
// TEAM KNOCKOUT ROUTES (NEW SIMPLIFIED CONTROLLER)
// ================================

// Tournament Creation
router.post(
  "/team-knockout/create",
  teamKnockoutController.createTournamentFromBookings
);

// Round Robin
router.post(
  "/team-knockout/round-robin/generate",
  teamKnockoutController.generateRoundRobinMatches
);
router.get(
  "/team-knockout/round-robin/standings/:tournamentId",
  teamKnockoutController.getRoundRobinStandings
);
router.post(
  "/team-knockout/round-robin/delete",
  teamKnockoutController.deleteRoundRobinMatches
);

// Bulk upload scores for team knockout matches
router.post(
  "/team-knockout/bulk-upload-scores",
  teamKnockoutController.bulkUploadScores
);

// Live Scoring
router.get(
  "/team-knockout/matches/:matchId/live-state",
  teamKnockoutController.getLiveMatchState
);
router.put(
  "/team-knockout/matches/:matchId/live-score",
  teamKnockoutController.updateLiveScore
);
router.post(
  "/team-knockout/matches/:matchId/complete-game",
  teamKnockoutController.completeGame
);

// Captain's doubles pairing selection
router.post(
  "/team-knockout/matches/:matchId/select-pairing",
  teamKnockoutController.selectDoublesPairing
);

// Match Queries
router.get(
  "/team-knockout/matches/:tournamentId",
  teamKnockoutController.getMatchesByTournament
);
router.get(
  "/team-knockout/matches-by-round",
  teamKnockoutController.getMatchesByRound
);
router.get(
  "/:tournamentId/matches-by-tournament",
  teamKnockoutController.getMatchesByTournament
);
router.get(
  "/team-knockout/match/:matchId",
  teamKnockoutController.getMatchById
);

// Next Round Generation
router.post(
  "/team-knockout/next-round",
  teamKnockoutController.createNextRound
);

// Team Management
router.get(
  "/team-knockout/teams/:tournamentId",
  teamKnockoutController.getTeamsByTournament
);

// Player Substitutions
router.post(
  "/team-knockout/teams/:teamId/swap-players",
  teamKnockoutController.swapTeamPlayers
);

router.post(
  "/team-knockout/matches/:matchId/substitute",
  teamKnockoutController.updateMatchLineup
);

// Utility Functions
router.post(
  "/team-knockout/matches/:matchId/start",
  teamKnockoutController.startMatch
);
router.put(
  "/team-knockout/matches/:matchId/reschedule",
  teamKnockoutController.rescheduleMatch
);
router.put(
  "/team-knockout/matches/:matchId/cancel",
  teamKnockoutController.cancelMatch
);

// Statistics
router.get(
  "/team-knockout/tournaments/:tournamentId/stats",
  teamKnockoutController.getTournamentStatistics
);
router.get(
  "/team-knockout/matches/:matchId/stats",
  teamKnockoutController.getMatchStatistics
);

// Compatibility Route (IMPORTANT: Keep this for existing frontend)
router.get(
  "/players/bookings/tournament-teams/:tournamentId",
  teamKnockoutController.getBookingTeams
);

// Reset & Health
router.delete(
  "/team-knockout/tournaments/:tournamentId/reset",
  teamKnockoutController.resetTournament
);

// Match Status (for scoreboard initialization)
router.get(
  "/tournaments/match-status/:matchId",
  teamKnockoutController.getMatchById
);

// Live Score Updates (for real-time scoring)
router.patch(
  "/tournaments/matches/:matchId",
  teamKnockoutController.updateLiveScore
);

// Player Substitutions (for scoreboard substitutions)
router.post(
  "/tournaments/matches/:matchId/substitute",
  teamKnockoutController.substitutePlayer
);

router.get("/team-knockout/health", teamKnockoutController.healthCheck);

// ═══════════════════════════════════════════════════════════════
// BULK RESULT UPLOAD (CSV/Excel file upload)
// ═══════════════════════════════════════════════════════════════
const bulkResultUploadController = require("../controllers/bulkResultUploadController");

// Multer config for result files (CSV/XLSX, max 10MB)
const resultUploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "../uploads/results");
    const fs = require("fs");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `results-${Date.now()}-${file.originalname}`);
  },
});
const resultUpload = multer({
  storage: resultUploadStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [".csv", ".xlsx", ".xls"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${ext}. Allowed: ${allowed.join(", ")}`));
    }
  },
});

router.post("/bulk-result-upload", resultUpload.single("file"), bulkResultUploadController.uploadResults);
router.post("/bulk-result-upload/preview", resultUpload.single("file"), bulkResultUploadController.previewFile);
router.get("/bulk-result-upload/template", bulkResultUploadController.downloadTemplate);

module.exports = router;
