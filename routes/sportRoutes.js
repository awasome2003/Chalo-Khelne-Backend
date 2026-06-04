const express = require("express");
const router = express.Router();
const sportController = require("../controllers/sportController");
const { requireSuperAdmin } = require("../middleware/authMiddleware");

// Read endpoints — public catalog
router.get("/", sportController.getAllSports);
router.get("/active", sportController.getActiveSports);
router.get("/presets", sportController.getSportPresets);
router.get("/default-format/:sportName", sportController.getDefaultFormat);
router.get("/tournaments/:sportName", sportController.getTournamentsBySport);
router.get("/venues/:sportName", sportController.getVenuesBySport);
router.get("/training/:sportName", sportController.getTrainingBySport);

// Write endpoints — superadmin only
router.post("/", requireSuperAdmin, sportController.createSport);
router.post("/seed", requireSuperAdmin, sportController.seedSports);
router.put("/:id", requireSuperAdmin, sportController.updateSport);
router.put("/:id/config", requireSuperAdmin, sportController.updateSportConfig);

module.exports = router;
