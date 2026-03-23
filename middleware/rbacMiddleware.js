const jwt = require("jsonwebtoken");
const User = require("../Modal/User");
const { Manager } = require("../Modal/ClubManager");
const Superadminmodel = require("../Modal/Superadminmodel");
const Role = require("../Modal/Role");

// ═══════════════════════════════════════════════════════════════
// UNIFIED AUTH — Resolves token → user/manager/superadmin + role
// ═══════════════════════════════════════════════════════════════

/**
 * Unified authentication middleware.
 * Decodes JWT, finds the account across all models,
 * resolves the RBAC role, and attaches to req.
 *
 * After this middleware:
 *   req.account       — the user/manager/superadmin document
 *   req.accountType   — "User" | "Manager" | "SuperAdmin"
 *   req.accountId     — the account's _id (string)
 *   req.callerRole    — the Role document (with permissions populated)
 *   req.isSuperAdmin  — boolean shorthand
 */
const unifiedAuth = async (req, res, next) => {
  const authHeader = req.header("Authorization");
  if (!authHeader) {
    return res.status(401).json({ message: "Authorization denied. No token provided." });
  }

  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) {
    return res.status(401).json({ message: "Authorization denied. Empty token." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ── SuperAdmin (JWT has email + role:"superadmin", no id) ──
    if (decoded.role === "superadmin" && decoded.email) {
      const superadmin = await Superadminmodel.findOne({ email: decoded.email });
      if (!superadmin) {
        return res.status(401).json({ message: "SuperAdmin not found." });
      }
      req.account = superadmin;
      req.accountType = "SuperAdmin";
      req.accountId = superadmin._id.toString();
      req.isSuperAdmin = true;

      // Resolve RBAC role (or create virtual one)
      const saRole = await Role.findOne({ slug: "super_admin" }).populate("permissions");
      req.callerRole = saRole || { slug: "super_admin", authorityLevel: 0, permissions: [] };

      // Legacy compatibility
      req.user = { id: superadmin._id, email: decoded.email, role: "superadmin" };
      return next();
    }

    // ── Resolve account ID from various JWT formats ──
    const accountId = decoded.id || decoded.userId;
    if (!accountId) {
      return res.status(401).json({ message: "Invalid token payload." });
    }

    // ── Try User model first ──
    let user = await User.findById(accountId);
    if (user) {
      req.account = user;
      req.accountType = "User";
      req.accountId = user._id.toString();
      req.isSuperAdmin = false;

      // Map legacy role string to RBAC role slug
      const roleSlug = mapLegacyRole(user.role);
      const rbacRole = await Role.findOne({ slug: roleSlug }).populate("permissions");
      req.callerRole = rbacRole || { slug: roleSlug, authorityLevel: 99, permissions: [] };

      // Legacy compatibility
      req.user = { id: user._id, email: user.email, role: user.role };
      return next();
    }

    // ── Try Manager model ──
    let manager = await Manager.findById(accountId);
    if (manager) {
      req.account = manager;
      req.accountType = "Manager";
      req.accountId = manager._id.toString();
      req.isSuperAdmin = false;

      const rbacRole = await Role.findOne({ slug: "manager" }).populate("permissions");
      req.callerRole = rbacRole || { slug: "manager", authorityLevel: 2, permissions: [] };

      // Legacy compatibility
      req.user = { id: manager._id, email: manager.email, role: "Manager" };
      return next();
    }

    return res.status(401).json({ message: "Account not found." });
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Token expired." });
    }
    return res.status(401).json({ message: "Invalid token." });
  }
};

// ═══════════════════════════════════════════════════════════════
// PERMISSION CHECK — Verify caller has specific permission(s)
// ═══════════════════════════════════════════════════════════════

/**
 * Creates middleware that checks if the caller has the required permission.
 * SuperAdmin always passes.
 *
 * Usage:
 *   router.post("/create", unifiedAuth, requirePermission("tournament:create"), handler)
 *   router.delete("/:id", unifiedAuth, requirePermission("tournament:delete"), handler)
 */
const requirePermission = (...permissionKeys) => {
  return (req, res, next) => {
    // SuperAdmin bypasses all permission checks
    if (req.isSuperAdmin) return next();

    const role = req.callerRole;
    if (!role || !role.permissions) {
      return res.status(403).json({
        message: "Access denied. No role assigned.",
      });
    }

    const grantedKeys = new Set(
      role.permissions
        .filter((p) => p.isActive !== false)
        .map((p) => (typeof p === "string" ? p : p.key))
    );

    // Check if caller has ALL required permissions
    const missing = permissionKeys.filter((k) => !grantedKeys.has(k));
    if (missing.length > 0) {
      return res.status(403).json({
        message: "Access denied. Missing permissions.",
        required: permissionKeys,
        missing,
      });
    }

    next();
  };
};

/**
 * Creates middleware that checks if caller has ANY of the listed permissions.
 *
 * Usage:
 *   router.get("/", unifiedAuth, requireAnyPermission("tournament:read", "tournament:manage"), handler)
 */
const requireAnyPermission = (...permissionKeys) => {
  return (req, res, next) => {
    if (req.isSuperAdmin) return next();

    const role = req.callerRole;
    if (!role || !role.permissions) {
      return res.status(403).json({ message: "Access denied. No role assigned." });
    }

    const grantedKeys = new Set(
      role.permissions
        .filter((p) => p.isActive !== false)
        .map((p) => (typeof p === "string" ? p : p.key))
    );

    const hasAny = permissionKeys.some((k) => grantedKeys.has(k));
    if (!hasAny) {
      return res.status(403).json({
        message: "Access denied. Need at least one of the required permissions.",
        required: permissionKeys,
      });
    }

    next();
  };
};

// ═══════════════════════════════════════════════════════════════
// ROLE CHECK — Verify caller has minimum authority level
// ═══════════════════════════════════════════════════════════════

/**
 * Checks if caller's role has authority level ≤ the required level.
 * Lower number = higher authority.
 *
 * Usage:
 *   router.post("/admin-only", unifiedAuth, requireAuthority(1), handler) // ClubAdmin+
 *   router.post("/manager-up", unifiedAuth, requireAuthority(2), handler)  // Manager+
 */
const requireAuthority = (maxLevel) => {
  return (req, res, next) => {
    if (req.isSuperAdmin) return next();

    const role = req.callerRole;
    if (!role || role.authorityLevel === undefined) {
      return res.status(403).json({ message: "Access denied. No role assigned." });
    }

    if (role.authorityLevel > maxLevel) {
      return res.status(403).json({
        message: "Access denied. Insufficient authority level.",
        required: maxLevel,
        current: role.authorityLevel,
      });
    }

    next();
  };
};

/**
 * Restricts access to specific role slugs.
 *
 * Usage:
 *   router.get("/sa-only", unifiedAuth, requireRole("super_admin"), handler)
 *   router.get("/admins", unifiedAuth, requireRole("super_admin", "club_admin"), handler)
 */
const requireRole = (...roleSlugs) => {
  return (req, res, next) => {
    if (req.isSuperAdmin && roleSlugs.includes("super_admin")) return next();

    const role = req.callerRole;
    if (!role || !roleSlugs.includes(role.slug)) {
      return res.status(403).json({
        message: "Access denied. Role not authorized.",
        required: roleSlugs,
        current: role?.slug || "none",
      });
    }

    next();
  };
};

// ═══════════════════════════════════════════════════════════════
// HELPER — Map legacy role strings to RBAC slugs
// ═══════════════════════════════════════════════════════════════

function mapLegacyRole(legacyRole) {
  const map = {
    SuperAdmin: "super_admin",
    superadmin: "super_admin",
    ClubAdmin: "club_admin",
    clubadmin: "club_admin",
    Manager: "manager",
    manager: "manager",
    Trainer: "trainer",
    trainer: "trainer",
    Player: "player",
    player: "player",
    Team: "team",
    team: "team",
    Referee: "referee",
    referee: "referee",
  };
  return map[legacyRole] || "player";
}

module.exports = {
  unifiedAuth,
  requirePermission,
  requireAnyPermission,
  requireAuthority,
  requireRole,
};
