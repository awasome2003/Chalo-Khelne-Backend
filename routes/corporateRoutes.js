const express = require("express");
const router = express.Router();
const {
    createCorporateProfile,
    getCorporateProfile,
    updateCorporateProfile,
    addManager,
    onboardCorporateAdmin,
} = require("../controllers/CorporateController");
const { authenticate, requireSuperAdmin, requireRole } = require("../middleware/authMiddleware");
const { requireSelf } = require("../middleware/authz");

// POST - Create a new Corporate profile (corporate admin or superadmin)
router.post("/", requireRole("corporate_admin", "superadmin"), createCorporateProfile);

// POST - Add a new manager to a Corporate profile (corporate admin or superadmin)
router.post("/manager", requireRole("corporate_admin", "superadmin"), addManager);

// POST - Onboard a Corporate Admin (User + Profile + Credentials) — superadmin only
router.post("/onboard", requireSuperAdmin, onboardCorporateAdmin);

// GET - Get Corporate profile by userId (own profile)
router.get("/:userId", authenticate, requireSelf("userId"), getCorporateProfile);

// PUT - Update Corporate profile by userId (own profile)
router.put("/:userId", authenticate, requireSelf("userId"), updateCorporateProfile);

module.exports = router;
