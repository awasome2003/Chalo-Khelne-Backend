const express = require("express");
const router = express.Router();
const {
  getClubAdminProfile,
  updateClubAdminProfile,
  createClubAdminProfile,
  onboardClubAdmin,
  getAllClubAdmins,
  deleteClubAdmin,
  bulkDeleteClubAdmins,
  toggleClubAdminStatus,
} = require("../controllers/ClubAdminController");

// POST - Create a new ClubAdmin profile
router.post("/", createClubAdminProfile);

// POST - Onboard a new ClubAdmin (User + Profile + Credentials)
router.post("/onboard", onboardClubAdmin);

// GET - Get ClubAdmin profile + clubName, email, mobile
router.get("/:userId", getClubAdminProfile);

// PUT - Update ClubAdmin profile
router.put("/:userId", updateClubAdminProfile);

// GET - Get All ClubAdmins
router.get("/", getAllClubAdmins);

// DELETE - Bulk delete club admins (must be before /:userId)
router.delete("/bulk", bulkDeleteClubAdmins);

// DELETE - Delete a ClubAdmin profile and user
router.delete("/:userId", deleteClubAdmin);

// PATCH - Toggle active status
router.patch("/:userId/status", toggleClubAdminStatus);

module.exports = router;
