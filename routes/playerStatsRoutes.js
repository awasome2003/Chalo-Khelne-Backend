const express = require("express");
const router = express.Router();
const { getPlayerCareerStats, getGlobalRankings } = require("../controllers/playerStatsController");

router.get("/:userId", getPlayerCareerStats);
router.get("/ranking/:sport?", getGlobalRankings);

module.exports = router;
