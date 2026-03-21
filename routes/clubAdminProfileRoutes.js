const express = require("express");
const router = express.Router();
const {
  getClubAdminProfile,
  updateClubAdminProfile,
  createClubAdminProfile,
  onboardClubAdmin,
} = require("../controllers/ClubAdminController");

// POST - Create a new ClubAdmin profile
router.post("/", createClubAdminProfile);

// POST - Onboard a new ClubAdmin (User + Profile + Credentials)
router.post("/onboard", onboardClubAdmin);

// GET - Get ClubAdmin profile + clubName, email, mobile
router.get("/:userId", getClubAdminProfile);

// PUT - Update ClubAdmin profile
router.put("/:userId", updateClubAdminProfile);

module.exports = router;
