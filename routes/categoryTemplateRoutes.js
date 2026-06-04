const express = require("express");
const router = express.Router();
const controller = require("../controllers/categoryTemplateController");
const { unifiedAuth, requireRole } = require("../middleware/rbacMiddleware");

// Read endpoints — any authenticated account (Manager, Player, SuperAdmin)
// can list templates. SuperAdmin gets `?all=1` to include inactive rows.
router.get("/",          unifiedAuth, controller.listTemplates);
router.get("/usage",     unifiedAuth, requireRole("super_admin"), controller.getUsageCounts);
router.get("/suggest",   unifiedAuth, requireRole("super_admin"), controller.suggestFromLabel);
router.get("/:id",       unifiedAuth, controller.getTemplate);

// Write endpoints — SuperAdmin only.
router.post("/",         unifiedAuth, requireRole("super_admin"), controller.createTemplate);
router.put("/:id",       unifiedAuth, requireRole("super_admin"), controller.updateTemplate);
router.patch("/:id",     unifiedAuth, requireRole("super_admin"), controller.updateTemplate);
router.delete("/:id",    unifiedAuth, requireRole("super_admin"), controller.deleteTemplate);
router.post("/seed",     unifiedAuth, requireRole("super_admin"), controller.seedTemplates);

module.exports = router;
