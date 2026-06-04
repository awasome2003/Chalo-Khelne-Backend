const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/sportLibraryController");
const { requireSuperAdmin } = require("../middleware/authMiddleware");

// Public reads
router.get("/", ctrl.getAll);
router.get("/:idOrSlug", ctrl.getOne);

// Admin writes — superadmin only.
router.post("/", requireSuperAdmin, ctrl.create);
router.put("/:id", requireSuperAdmin, ctrl.update);
router.patch("/:id/toggle", requireSuperAdmin, ctrl.toggleActive);
router.delete("/:id", requireSuperAdmin, ctrl.remove);

module.exports = router;
