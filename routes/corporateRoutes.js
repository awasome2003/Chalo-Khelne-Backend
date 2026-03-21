const express = require("express");
const router = express.Router();
const {
    createCorporateProfile,
    getCorporateProfile,
    updateCorporateProfile,
    addManager,
    onboardCorporateAdmin,
} = require("../controllers/CorporateController");

// POST - Create a new Corporate profile
router.post("/", createCorporateProfile);

// POST - Add a new manager to a Corporate profile
router.post("/manager", addManager);

// POST - Onboard a Corporate Admin (User + Profile + Credentials)
router.post("/onboard", onboardCorporateAdmin);

// GET - Get Corporate profile by userId
router.get("/:userId", getCorporateProfile);

// PUT - Update Corporate profile by userId
router.put("/:userId", updateCorporateProfile);

module.exports = router;
