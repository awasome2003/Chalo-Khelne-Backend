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
const { authenticate, requireSuperAdmin, requireRole } = require("../middleware/authMiddleware");
const { requireSelf } = require("../middleware/authz");

// POST - Create a new ClubAdmin profile (club admin or superadmin)
router.post("/", requireRole("ClubAdmin", "superadmin"), createClubAdminProfile);

// POST - Onboard a new ClubAdmin (User + Profile + Credentials) — superadmin only
router.post("/onboard", requireSuperAdmin, onboardClubAdmin);

// GET - Get ClubAdmin profile + clubName, email, mobile (own profile)
router.get("/:userId", authenticate, requireSelf("userId"), getClubAdminProfile);

// PUT - Update ClubAdmin profile (own profile)
router.put("/:userId", authenticate, requireSelf("userId"), updateClubAdminProfile);

// GET - Get All ClubAdmins — superadmin only
router.get("/", requireSuperAdmin, getAllClubAdmins);

// DELETE - Bulk delete club admins (must be before /:userId) — superadmin only
router.delete("/bulk", requireSuperAdmin, bulkDeleteClubAdmins);

// DELETE - Delete a ClubAdmin profile and user — superadmin only
router.delete("/:userId", requireSuperAdmin, deleteClubAdmin);

// PATCH - Toggle active status — superadmin only
router.patch("/:userId/status", requireSuperAdmin, toggleClubAdminStatus);

module.exports = router;
