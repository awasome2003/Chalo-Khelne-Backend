const express = require("express");
const router = express.Router();
const sportController = require("../controllers/sportController");

// Read endpoints (no auth for now — will add RBAC in Day 3)
router.get("/", sportController.getAllSports);
router.get("/active", sportController.getActiveSports);
router.get("/presets", sportController.getSportPresets);
router.get("/default-format/:sportName", sportController.getDefaultFormat);
router.get("/tournaments/:sportName", sportController.getTournamentsBySport);
router.get("/venues/:sportName", sportController.getVenuesBySport);
router.get("/training/:sportName", sportController.getTrainingBySport);

// Write endpoints (no auth for now — will add RBAC in Day 3)
router.post("/", sportController.createSport);
router.post("/seed", sportController.seedSports);
router.put("/:id", sportController.updateSport);
router.put("/:id/config", sportController.updateSportConfig);

module.exports = router;
