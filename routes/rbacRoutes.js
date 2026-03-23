const express = require("express");
const router = express.Router();
const rbacController = require("../controllers/rbacController");

// ═══════════════════════════════════════════
// PERMISSIONS
// ═══════════════════════════════════════════
router.get("/permissions/list", rbacController.listPermissions);
router.post("/permissions", rbacController.createPermission);
router.delete("/permissions/:id", rbacController.deletePermission);

// ═══════════════════════════════════════════
// ROLES
// ═══════════════════════════════════════════
router.get("/", rbacController.listRoles);
router.get("/matrix", rbacController.getRbacMatrix);
router.get("/:id", rbacController.getRole);
router.post("/", rbacController.createRole);
router.put("/:id", rbacController.updateRole);
router.delete("/:id", rbacController.deleteRole);

// ═══════════════════════════════════════════
// PERMISSION ASSIGNMENT
// ═══════════════════════════════════════════
router.post("/assign-permission", rbacController.assignPermission);
router.post("/bulk-assign-permissions", rbacController.bulkAssignPermissions);
router.post("/revoke-permission", rbacController.revokePermission);
router.post("/set-permissions", rbacController.setPermissions);

// ═══════════════════════════════════════════
// SEED (initialize defaults)
// ═══════════════════════════════════════════
router.post("/seed", require("../scripts/seedRbac"));

module.exports = router;
