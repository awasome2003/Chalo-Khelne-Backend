const express = require("express");
const router = express.Router();
const { getPlayerCareerStats, getGlobalRankings, getClubRankings } = require("../controllers/playerStatsController");
const { authenticate } = require("../middleware/authMiddleware");

// Require a logged-in user (was public — allowed unauthenticated enumeration of any player's stats).
router.get("/:userId", authenticate, getPlayerCareerStats);
// MUST come BEFORE /ranking/:sport? — otherwise "clubs" gets captured as :sport.
router.get("/ranking/clubs", authenticate, getClubRankings);
router.get("/ranking/:sport?", authenticate, getGlobalRankings);

module.exports = router;
