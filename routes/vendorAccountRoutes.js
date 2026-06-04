const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/vendorAccountController");
const { requireSuperAdmin, authenticate, requireRole } = require("../middleware/authMiddleware");

// ── Vendor self-service (role "vendor") ──
// MUST be declared before "/:id" so "me" isn't captured as an id param.
router.get("/me", authenticate, requireRole("vendor"), ctrl.getMyVendorProfile);
router.patch("/me", authenticate, requireRole("vendor"), ctrl.updateMyVendorProfile);

// ── SuperAdmin vendor management ──
router.post("/", requireSuperAdmin, ctrl.createVendor);
router.get("/", requireSuperAdmin, ctrl.listVendors);
router.get("/:id", requireSuperAdmin, ctrl.getVendor);
router.patch("/:id", requireSuperAdmin, ctrl.updateVendor);
router.post("/:id/reset-password", requireSuperAdmin, ctrl.resetVendorPassword);

module.exports = router;
