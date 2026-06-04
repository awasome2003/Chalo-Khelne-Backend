const express = require("express");
const router = express.Router();
const vendorController = require("../controllers/vendorController");
const { requireSuperAdmin } = require("../middleware/authMiddleware");

// ── Public routes (read-only catalog + anonymous click tracking) ──
router.get("/:id", vendorController.getEquipment);
router.post("/vendor-click/:id", vendorController.trackClick);

// ── SuperAdmin-only routes (vendor-link management) ──
router.get("/", requireSuperAdmin, vendorController.getAllEquipment);
router.get("/vendor-links/list", requireSuperAdmin, vendorController.getLinkedEquipment);
router.post("/vendor-link", requireSuperAdmin, vendorController.addVendorLink);
router.delete("/vendor-link/:id", requireSuperAdmin, vendorController.removeVendorLink);

module.exports = router;
