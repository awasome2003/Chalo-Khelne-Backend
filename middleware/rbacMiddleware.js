const jwt = require("jsonwebtoken");
const User = require("../src/modules/identity/models/User");
const { Manager } = require("../src/modules/identity/models/ClubManager");
const Superadminmodel = require("../src/modules/identity/models/Superadminmodel");
const Role = require("../src/modules/identity/models/Role");

// ═══════════════════════════════════════════════════════════════
// UNIFIED AUTH — Resolves token → user/manager/superadmin + role
// ═══════════════════════════════════════════════════════════════

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
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });

    if (decoded.role === "superadmin" && decoded.email) {
      const superadmin = await Superadminmodel.findOne({ email: decoded.email });
      if (!superadmin) {
        return res.status(401).json({ message: "SuperAdmin not found." });
      }
      req.account = superadmin;
      req.accountType = "SuperAdmin";
      req.accountId = superadmin._id.toString();
      req.isSuperAdmin = true;
      const saRole = await Role.findOne({ slug: "super_admin" }).populate("permissions");
      req.callerRole = saRole || { slug: "super_admin", authorityLevel: 0, permissions: [] };
      req.user = { id: superadmin._id, email: decoded.email, role: "superadmin" };
      return next();
    }

    const accountId = decoded.id || decoded.userId;
    if (!accountId) {
      return res.status(401).json({ message: "Invalid token payload." });
    }

    let user = await User.findById(accountId);
    if (user) {
      req.account = user;
      req.accountType = "User";
      req.accountId = user._id.toString();
      req.isSuperAdmin = false;
      const roleSlug = mapLegacyRole(user.role);
      const rbacRole = await Role.findOne({ slug: roleSlug }).populate("permissions");
      req.callerRole = rbacRole || { slug: roleSlug, authorityLevel: 99, permissions: [] };
      req.user = { id: user._id, email: user.email, role: user.role };
      return next();
    }

    let manager = await Manager.findById(accountId);
    if (manager) {
      req.account = manager;
      req.accountType = "Manager";
      req.accountId = manager._id.toString();
      req.isSuperAdmin = false;
      const rbacRole = await Role.findOne({ slug: "manager" }).populate("permissions");
      req.callerRole = rbacRole || { slug: "manager", authorityLevel: 2, permissions: [] };
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
// LAZY CALLER-ROLE RESOLVER
// Bridges the legacy auth middlewares (authenticate, allowUserOrManager,
// managerAuth) to the RBAC pipeline. If unifiedAuth already ran,
// req.callerRole is set and we return it; otherwise we figure out the
// caller's role from whatever the legacy middleware left on the request.
// Returns the populated Role document, or null when unresolvable.
// ═══════════════════════════════════════════════════════════════
async function resolveCallerRole(req) {
  if (req.callerRole) return req.callerRole;

  let slug = null;

  if (req.isSuperAdmin || req.userRole === "SuperAdmin") {
    slug = "super_admin";
  } else if (req.userRole === "Manager") {
    slug = "manager";
  } else if (req.userRole === "User" && req.user) {
    // allowUserOrManager set req.user to the full User document.
    slug = mapLegacyRole(req.user.role || "Player");
  } else if (req.user) {
    // authenticate/managerAuth set req.user to the decoded JWT payload.
    const id = req.user.id || req.user._id || req.user.userId;
    if (id) {
      const user = await User.findById(id).select("role").lean();
      if (user) {
        slug = mapLegacyRole(user.role || "Player");
      } else {
        const manager = await Manager.findById(id).select("_id").lean();
        if (manager) slug = "manager";
      }
    }
    if (!slug && req.user.role) {
      slug = mapLegacyRole(req.user.role);
    }
  }

  if (!slug) return null;

  const role = await Role.findOne({ slug }).populate("permissions");
  req.callerRole = role;
  return role;
}

// ═══════════════════════════════════════════════════════════════
// PERMISSION CHECK — Verify caller has specific permission(s)
// ═══════════════════════════════════════════════════════════════

const DENY = {
  message: "Access denied. You don't have permission to perform this action.",
};

// Re-check the caller's status doc — defends against an existing valid JWT
// from a freshly-suspended account that the upstream legacy middleware didn't
// gate (e.g. routes that mounted rbac directly without authenticate first).
// SuperAdmin is never suspendable so we skip the lookup for them.
async function rejectIfSuspended(req, res) {
  if (req.isSuperAdmin || req.userRole === "SuperAdmin") return false;
  // If req.user is already a full doc with status, use it.
  if (req.user && typeof req.user.status === "string") {
    if (req.user.status === "active") return false;
    const code = req.user.status === "suspended" ? "ACCOUNT_SUSPENDED" : "ACCOUNT_REJECTED";
    res.status(403).json({
      success: false,
      code,
      message:
        code === "ACCOUNT_SUSPENDED"
          ? "Your account has been suspended. Contact support."
          : "Your account has been rejected. Contact support.",
      reason: req.user.suspensionReason || null,
    });
    return true;
  }
  // Otherwise do a defensive lookup by id.
  const id = req.user?.id || req.user?._id || req.user?.userId || req.accountId;
  if (!id) return false;
  let doc = null;
  if (req.accountType === "Manager" || req.userRole === "Manager") {
    doc = await Manager.findById(id).select("status suspensionReason").lean();
  } else {
    doc = await User.findById(id).select("status suspensionReason").lean();
    if (!doc) doc = await Manager.findById(id).select("status suspensionReason").lean();
  }
  if (!doc || !doc.status || doc.status === "active") return false;
  const code = doc.status === "suspended" ? "ACCOUNT_SUSPENDED" : "ACCOUNT_REJECTED";
  res.status(403).json({
    success: false,
    code,
    message:
      code === "ACCOUNT_SUSPENDED"
        ? "Your account has been suspended. Contact support."
        : "Your account has been rejected. Contact support.",
    reason: doc.suspensionReason || null,
  });
  return true;
}

const requirePermission = (...permissionKeys) => {
  return async (req, res, next) => {
    // SuperAdmin always bypasses (set by unifiedAuth, allowUserOrManager,
    // requireSuperAdmin, or any future SA-aware middleware).
    if (req.isSuperAdmin || req.userRole === "SuperAdmin") return next();

    // Suspension gate — between SA bypass and the permission check.
    if (await rejectIfSuspended(req, res)) return;

    let role;
    try {
      role = await resolveCallerRole(req);
    } catch (err) {
      return res.status(403).json(DENY);
    }

    if (!role || !role.permissions) {
      return res.status(403).json(DENY);
    }

    const grantedKeys = new Set(
      role.permissions
        .filter((p) => p && p.isActive !== false)
        .map((p) => (typeof p === "string" ? p : p.key))
    );

    const missing = permissionKeys.filter((k) => !grantedKeys.has(k));
    if (missing.length > 0) {
      return res.status(403).json(DENY);
    }

    next();
  };
};

const requireAnyPermission = (...permissionKeys) => {
  return async (req, res, next) => {
    if (req.isSuperAdmin || req.userRole === "SuperAdmin") return next();

    let role;
    try {
      role = await resolveCallerRole(req);
    } catch (err) {
      return res.status(403).json(DENY);
    }

    if (!role || !role.permissions) {
      return res.status(403).json(DENY);
    }

    const grantedKeys = new Set(
      role.permissions
        .filter((p) => p && p.isActive !== false)
        .map((p) => (typeof p === "string" ? p : p.key))
    );

    const hasAny = permissionKeys.some((k) => grantedKeys.has(k));
    if (!hasAny) {
      return res.status(403).json(DENY);
    }
    next();
  };
};

// ═══════════════════════════════════════════════════════════════
// AUTHORITY CHECK — Verify caller has minimum authority level
// ═══════════════════════════════════════════════════════════════

const requireAuthority = (maxLevel) => {
  return async (req, res, next) => {
    if (req.isSuperAdmin || req.userRole === "SuperAdmin") return next();

    let role;
    try {
      role = await resolveCallerRole(req);
    } catch (err) {
      return res.status(403).json(DENY);
    }

    if (!role || role.authorityLevel === undefined) {
      return res.status(403).json(DENY);
    }

    if (role.authorityLevel > maxLevel) {
      return res.status(403).json(DENY);
    }

    next();
  };
};

const requireRole = (...roleSlugs) => {
  return async (req, res, next) => {
    // SuperAdmin bypasses all role gates — never lock SA out, even if the
    // caller forgot to list "super_admin" in the allow-list.
    if (req.isSuperAdmin || req.userRole === "SuperAdmin") return next();

    let role;
    try {
      role = await resolveCallerRole(req);
    } catch (err) {
      return res.status(403).json(DENY);
    }

    if (!role || !roleSlugs.includes(role.slug)) {
      return res.status(403).json(DENY);
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
    corporate_admin: "club_admin",
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
  resolveCallerRole,
  requirePermission,
  requireAnyPermission,
  requireAuthority,
  requireRole,
};
