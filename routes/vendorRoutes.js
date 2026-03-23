const express = require("express");
const router = express.Router();
const vendorController = require("../controllers/vendorController");

// ── Public routes ──
router.get("/:id", vendorController.getEquipment);
router.post("/vendor-click/:id", vendorController.trackClick);

// ── SuperAdmin routes (no auth middleware for now — add RBAC later) ──
router.get("/", vendorController.getAllEquipment);
router.get("/vendor-links/list", vendorController.getLinkedEquipment);
router.post("/vendor-link", vendorController.addVendorLink);
router.delete("/vendor-link/:id", vendorController.removeVendorLink);

module.exports = router;
