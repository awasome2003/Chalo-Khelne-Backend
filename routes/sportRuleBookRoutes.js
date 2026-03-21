const express = require("express");
const router = express.Router();
const controller = require("../controllers/sportRuleBookController");

// Read endpoints
router.get("/", controller.getAllRuleBooks);
router.get("/presets", controller.getRulePresets);
router.get("/sport/:sportName", controller.getRulesBySport);
router.get("/sport/:sportName/levels", controller.getLevelsForSport);
router.get("/sport/:sportName/:level", controller.getRulesBysportAndLevel);
router.get("/:id", controller.getRuleBookById);

// Seed endpoint
router.post("/seed", controller.seedRuleBooks);

module.exports = router;
