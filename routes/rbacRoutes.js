const express = require("express");
const router = express.Router();
const rbacController = require("../controllers/rbacController");
const { requireSuperAdmin } = require("../middleware/authMiddleware");

// The RBAC control plane — roles, permissions, assignments, seed — is
// SuperAdmin-only in its entirety. Guard the whole router so no endpoint
// (current or future) is ever exposed unauthenticated.
router.use(requireSuperAdmin);

// ═══════════════════════════════════════════
// PERMISSIONS
// ═══════════════════════════════════════════
router.get("/permissions/list", rbacController.listPermissions);
router.post("/permissions", rbacController.createPermission);
router.delete("/permissions/:id", rbacController.deletePermission);

// ═══════════════════════════════════════════
// USER LIFECYCLE — suspend / reject / reactivate
// MUST be declared BEFORE `/:id` and other dynamic role routes below,
// otherwise Express matches "users" as an :id and Role.findById("users")
// throws a CastError → 500. Static segments win on first-match.
// Within this block, the static "users/suspended" / "users" routes are
// declared before the dynamic "users/:userId/status" for the same reason.
// ═══════════════════════════════════════════
router.get("/users/suspended", rbacController.listSuspendedUsers);
router.get("/users", rbacController.listUsers);
router.get("/users/:userId/status", rbacController.getUserStatus);
router.patch("/users/:userId/status", rbacController.updateUserStatus);

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
