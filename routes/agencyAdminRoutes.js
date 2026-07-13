/**
 * Agency admin (tournament agency) management — SuperAdmin only.
 * Mounted at /api/agency.
 */
const express = require("express");
const router = express.Router();
const { onboardAgency, listAgencies } = require("../controllers/agencyAdminController");
const { requireSuperAdmin } = require("../middleware/authMiddleware");

router.post("/onboard", requireSuperAdmin, onboardAgency);
router.get("/", requireSuperAdmin, listAgencies);

module.exports = router;
