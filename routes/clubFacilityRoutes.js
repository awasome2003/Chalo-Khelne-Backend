/**
 * Club (facility-business) admin management — SuperAdmin only.
 * Mounted at /api/club-facility.
 */
const express = require("express");
const router = express.Router();
const { onboardClubFacility, listClubFacilities } = require("../controllers/clubFacilityController");
const { requireSuperAdmin } = require("../middleware/authMiddleware");

router.post("/onboard", requireSuperAdmin, onboardClubFacility);
router.get("/", requireSuperAdmin, listClubFacilities);

module.exports = router;
