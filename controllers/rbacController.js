const Role = require("../src/modules/identity/models/Role");
const Permission = require("../src/modules/identity/models/Permission");
const mongoose = require("mongoose");
const User = require("../src/modules/identity/models/User");
const { Manager } = require("../src/modules/identity/models/ClubManager");

// ═══════════════════════════════════════════════════════════════
// USER-LIFECYCLE HELPERS — suspend / reject / reactivate
// ═══════════════════════════════════════════════════════════════

// Maps the `userType` body field to the right collection. Anything that
// isn't "manager" is a User document (Player / ClubAdmin / Trainer / Referee
// / Corporate are all sub-roles inside the User collection).
function resolveUserModel(userType) {
  if (!userType) return User;
  return String(userType).toLowerCase() === "manager" ? Manager : User;
}

// Returns a small DTO matching what the SA panel needs.
function toUserDto(doc, userType) {
  if (!doc) return null;
  return {
    id: doc._id,
    name: doc.name,
    email: doc.email,
    role: userType || (doc.role ? doc.role : "manager"),
    status: doc.status || "active",
    suspensionReason: doc.suspensionReason || null,
    suspendedAt: doc.suspendedAt || null,
    suspendedBy: doc.suspendedBy || null,
  };
}

const rbacController = {
  // ═══════════════════════════════════════════
  // PERMISSIONS
  // ═══════════════════════════════════════════

  // List all permissions (grouped by module)
  listPermissions: async (req, res) => {
    try {
      const { module, active } = req.query;
      const filter = {};
      if (module) filter.module = module.toLowerCase();
      if (active !== undefined) filter.isActive = active === "true";

      const permissions = await Permission.find(filter).sort({ module: 1, action: 1 });

      // Group by module
      const grouped = permissions.reduce((acc, p) => {
        if (!acc[p.module]) acc[p.module] = [];
        acc[p.module].push(p);
        return acc;
      }, {});

      res.json({
        success: true,
        total: permissions.length,
        modules: Object.keys(grouped).length,
        permissions: grouped,
        flat: permissions,
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // Create a new permission
  createPermission: async (req, res) => {
    try {
      const { key, name, description, module, action } = req.body;

      if (!key || !name || !module || !action) {
        return res.status(400).json({
          success: false,
          message: "key, name, module, and action are required",
        });
      }

      const exists = await Permission.findOne({ key: key.toLowerCase() });
      if (exists) {
        return res.status(409).json({
          success: false,
          message: `Permission '${key}' already exists`,
        });
      }

      const permission = await Permission.create({
        key: key.toLowerCase(),
        name,
        description,
        module: module.toLowerCase(),
        action: action.toLowerCase(),
      });

      // Auto-grant new permissions to SuperAdmin so the role doc never drifts
      // out of sync with the "SA has everything" guarantee. (SA still bypasses
      // permission checks at runtime — this keeps the matrix view honest and
      // any future permission-introspection consistent.)
      await Role.updateOne(
        { slug: "super_admin" },
        { $addToSet: { permissions: permission._id } }
      );

      res.status(201).json({ success: true, permission });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // Delete a permission (only non-system)
  deletePermission: async (req, res) => {
    try {
      const permission = await Permission.findById(req.params.id);
      if (!permission) {
        return res.status(404).json({ success: false, message: "Permission not found" });
      }
      if (permission.isSystem) {
        return res.status(403).json({
          success: false,
          message: "System permissions cannot be deleted",
        });
      }

      // Remove from all roles that have it
      await Role.updateMany(
        { permissions: permission._id },
        { $pull: { permissions: permission._id } }
      );

      await Permission.findByIdAndDelete(req.params.id);
      res.json({ success: true, message: "Permission deleted" });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // ═══════════════════════════════════════════
  // ROLES
  // ═══════════════════════════════════════════

  // List all roles
  listRoles: async (req, res) => {
    try {
      const roles = await Role.find({ isActive: true })
        .populate("permissions", "key name module action isActive")
        .sort({ authorityLevel: 1 });

      res.json({ success: true, roles });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // Get single role with permissions
  getRole: async (req, res) => {
    try {
      const role = await Role.findById(req.params.id).populate(
        "permissions",
        "key name description module action isActive"
      );
      if (!role) {
        return res.status(404).json({ success: false, message: "Role not found" });
      }
      res.json({ success: true, role });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // Create a new role
  createRole: async (req, res) => {
    try {
      const { name, slug, authorityLevel, description, color, icon } = req.body;

      if (!name || !slug || authorityLevel === undefined) {
        return res.status(400).json({
          success: false,
          message: "name, slug, and authorityLevel are required",
        });
      }

      // Escalation prevention: cannot create role with higher authority than own
      const callerRole = req.callerRole;
      if (callerRole && authorityLevel <= callerRole.authorityLevel) {
        return res.status(403).json({
          success: false,
          message: "Cannot create a role with higher or equal authority than your own",
        });
      }

      const exists = await Role.findOne({
        $or: [{ name }, { slug: slug.toLowerCase() }],
      });
      if (exists) {
        return res.status(409).json({
          success: false,
          message: "Role with this name or slug already exists",
        });
      }

      const role = await Role.create({
        name,
        slug: slug.toLowerCase(),
        authorityLevel,
        description,
        color,
        icon,
      });

      res.status(201).json({ success: true, role });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // Update a role
  updateRole: async (req, res) => {
    try {
      const role = await Role.findById(req.params.id);
      if (!role) {
        return res.status(404).json({ success: false, message: "Role not found" });
      }

      // Cannot rename system roles
      if (role.isSystem && req.body.name && req.body.name !== role.name) {
        return res.status(403).json({
          success: false,
          message: "System role names cannot be changed",
        });
      }

      // Cannot change authority level of system roles
      if (role.isSystem && req.body.authorityLevel !== undefined && req.body.authorityLevel !== role.authorityLevel) {
        return res.status(403).json({
          success: false,
          message: "System role authority levels cannot be changed",
        });
      }

      const { name, description, color, icon, isActive } = req.body;
      if (name) role.name = name;
      if (description !== undefined) role.description = description;
      if (color) role.color = color;
      if (icon) role.icon = icon;
      if (isActive !== undefined) role.isActive = isActive;

      await role.save();
      res.json({ success: true, role });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // Delete a role (only non-system)
  deleteRole: async (req, res) => {
    try {
      const role = await Role.findById(req.params.id);
      if (!role) {
        return res.status(404).json({ success: false, message: "Role not found" });
      }
      if (role.isSystem) {
        return res.status(403).json({
          success: false,
          message: "System roles cannot be deleted",
        });
      }
      await Role.findByIdAndDelete(req.params.id);
      res.json({ success: true, message: `Role '${role.name}' deleted` });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // ═══════════════════════════════════════════
  // PERMISSION ASSIGNMENT
  // ═══════════════════════════════════════════

  // Assign a single permission to a role
  assignPermission: async (req, res) => {
    try {
      const { roleId, permissionId } = req.body;

      const role = await Role.findById(roleId);
      if (!role) return res.status(404).json({ success: false, message: "Role not found" });

      const permission = await Permission.findById(permissionId);
      if (!permission) return res.status(404).json({ success: false, message: "Permission not found" });

      // Check if already assigned
      if (role.permissions.includes(permissionId)) {
        return res.status(409).json({
          success: false,
          message: "Permission already assigned to this role",
        });
      }

      role.permissions.push(permissionId);
      await role.save();

      const updated = await Role.findById(roleId).populate("permissions", "key name module action");
      res.json({ success: true, message: "Permission assigned", role: updated });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // Bulk assign permissions to a role
  bulkAssignPermissions: async (req, res) => {
    try {
      const { roleId, permissionIds } = req.body;

      if (!roleId || !permissionIds || !Array.isArray(permissionIds)) {
        return res.status(400).json({
          success: false,
          message: "roleId and permissionIds array are required",
        });
      }

      const role = await Role.findById(roleId);
      if (!role) return res.status(404).json({ success: false, message: "Role not found" });

      // Verify all permissions exist
      const permissions = await Permission.find({ _id: { $in: permissionIds } });
      if (permissions.length !== permissionIds.length) {
        return res.status(400).json({
          success: false,
          message: "Some permission IDs are invalid",
        });
      }

      // Merge without duplicates
      const existingSet = new Set(role.permissions.map((p) => p.toString()));
      let added = 0;
      for (const pid of permissionIds) {
        if (!existingSet.has(pid.toString())) {
          role.permissions.push(pid);
          added++;
        }
      }

      await role.save();
      const updated = await Role.findById(roleId).populate("permissions", "key name module action");

      res.json({
        success: true,
        message: `${added} permissions assigned (${permissionIds.length - added} already existed)`,
        role: updated,
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // Revoke a permission from a role
  revokePermission: async (req, res) => {
    try {
      const { roleId, permissionId } = req.body;

      const role = await Role.findById(roleId);
      if (!role) return res.status(404).json({ success: false, message: "Role not found" });

      const index = role.permissions.indexOf(permissionId);
      if (index === -1) {
        return res.status(404).json({
          success: false,
          message: "Permission not assigned to this role",
        });
      }

      role.permissions.splice(index, 1);
      await role.save();

      const updated = await Role.findById(roleId).populate("permissions", "key name module action");
      res.json({ success: true, message: "Permission revoked", role: updated });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // Set exact permissions for a role (replace all)
  setPermissions: async (req, res) => {
    try {
      const { roleId, permissionIds } = req.body;

      const role = await Role.findById(roleId);
      if (!role) return res.status(404).json({ success: false, message: "Role not found" });

      if (role.isSystem && role.slug === "super_admin") {
        return res.status(403).json({
          success: false,
          message: "SuperAdmin permissions cannot be modified (bypass all checks)",
        });
      }

      // Verify all permissions exist
      const permissions = await Permission.find({ _id: { $in: permissionIds } });
      if (permissions.length !== permissionIds.length) {
        return res.status(400).json({
          success: false,
          message: "Some permission IDs are invalid",
        });
      }

      role.permissions = permissionIds;
      await role.save();

      const updated = await Role.findById(roleId).populate("permissions", "key name module action");
      res.json({
        success: true,
        message: `Role now has ${permissionIds.length} permissions`,
        role: updated,
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // ═══════════════════════════════════════════
  // RBAC MATRIX VIEW (for SuperAdmin dashboard)
  // ═══════════════════════════════════════════

  getRbacMatrix: async (req, res) => {
    try {
      const roles = await Role.find({ isActive: true })
        .populate("permissions", "key name module action")
        .sort({ authorityLevel: 1 });

      const allPermissions = await Permission.find({ isActive: true }).sort({
        module: 1,
        action: 1,
      });

      // Build matrix: roles × permissions
      const matrix = roles.map((role) => {
        const permKeys = new Set(role.permissions.map((p) => p.key));
        return {
          role: {
            _id: role._id,
            name: role.name,
            slug: role.slug,
            authorityLevel: role.authorityLevel,
            color: role.color,
            isSystem: role.isSystem,
          },
          isSuperAdmin: role.slug === "super_admin",
          permissions: allPermissions.map((p) => ({
            _id: p._id,
            key: p.key,
            name: p.name,
            module: p.module,
            action: p.action,
            granted: role.slug === "super_admin" ? true : permKeys.has(p.key),
          })),
        };
      });

      // Group permissions by module for display
      const modules = allPermissions.reduce((acc, p) => {
        if (!acc[p.module]) acc[p.module] = [];
        acc[p.module].push({ _id: p._id, key: p.key, name: p.name, action: p.action });
        return acc;
      }, {});

      res.json({
        success: true,
        matrix,
        modules,
        totalRoles: roles.length,
        totalPermissions: allPermissions.length,
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
  // ═══════════════════════════════════════════
  // USER LIFECYCLE — suspend / reject / reactivate / list
  // ═══════════════════════════════════════════

  // PATCH /api/roles/users/:userId/status
  // Body: { status: "active" | "suspended" | "rejected", reason: string, userType: "manager"|"player"|"club_admin"|"trainer"|"referee"|"corporate" }
  // Protected by requireSuperAdmin (router-level).
  updateUserStatus: async (req, res) => {
    try {
      const { userId } = req.params;
      const { status, reason, userType } = req.body || {};

      if (!["active", "suspended", "rejected"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid status. Must be one of: active, suspended, rejected.",
        });
      }
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ success: false, message: "Invalid user id." });
      }

      const Model = resolveUserModel(userType);
      const doc = await Model.findById(userId).select(
        "name email role status suspensionReason suspendedAt suspendedBy"
      );
      if (!doc) {
        return res.status(404).json({ success: false, message: "User not found." });
      }

      // ── Never allow SA to be suspended ──
      // (SuperAdmin lives in a separate Superadminmodel collection, so a SA
      // _id will never resolve via User/Manager. But if someone passed a real
      // SA id with userType=anything, the lookup above would already have
      // returned 404. This guard is belt-and-braces for any future model.)
      if (doc.role === "superadmin" || userType === "superadmin" || userType === "super_admin") {
        return res.status(400).json({
          success: false,
          message: "SuperAdmin accounts cannot be suspended or rejected.",
        });
      }

      if (status === "active") {
        doc.status = "active";
        doc.suspensionReason = null;
        doc.suspendedAt = null;
        doc.suspendedBy = null;
      } else {
        doc.status = status;
        doc.suspensionReason = (reason || "").trim() || null;
        doc.suspendedAt = new Date();
        doc.suspendedBy = req.superadminId || null;
      }

      await doc.save();

      return res.json({
        success: true,
        message: "User status updated",
        user: toUserDto(doc, userType),
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // GET /api/roles/users/suspended
  // Returns every suspended/rejected User + Manager.
  listSuspendedUsers: async (req, res) => {
    try {
      const [users, managers] = await Promise.all([
        User.find({ status: { $in: ["suspended", "rejected"] } })
          .select("name email role status suspensionReason suspendedAt suspendedBy")
          .sort({ suspendedAt: -1 })
          .lean(),
        Manager.find({ status: { $in: ["suspended", "rejected"] } })
          .select("name email status suspensionReason suspendedAt suspendedBy")
          .sort({ suspendedAt: -1 })
          .lean(),
      ]);

      const items = [
        ...users.map((u) => ({
          id: u._id,
          name: u.name,
          email: u.email,
          role: (u.role || "player").toLowerCase(),
          userType: (u.role || "player").toLowerCase(),
          status: u.status,
          suspensionReason: u.suspensionReason || null,
          suspendedAt: u.suspendedAt || null,
          suspendedBy: u.suspendedBy || null,
        })),
        ...managers.map((m) => ({
          id: m._id,
          name: m.name,
          email: m.email,
          role: "manager",
          userType: "manager",
          status: m.status,
          suspensionReason: m.suspensionReason || null,
          suspendedAt: m.suspendedAt || null,
          suspendedBy: m.suspendedBy || null,
        })),
      ].sort((a, b) => new Date(b.suspendedAt || 0) - new Date(a.suspendedAt || 0));

      return res.json({ success: true, total: items.length, items });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // GET /api/roles/users/:userId/status?userType=manager
  getUserStatus: async (req, res) => {
    try {
      const { userId } = req.params;
      const userType = req.query.userType;
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ success: false, message: "Invalid user id." });
      }
      const Model = resolveUserModel(userType);
      const doc = await Model.findById(userId)
        .select("name email role status suspensionReason suspendedAt suspendedBy")
        .lean();
      if (!doc) {
        return res.status(404).json({ success: false, message: "User not found." });
      }
      return res.json({ success: true, user: toUserDto(doc, userType) });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // GET /api/roles/users — list every user (active + suspended + rejected) for
  // the SA "User Access" tab. Supports ?role= and ?status= filters and a
  // basic ?search= match on name/email. Soft cap: 500 rows per request.
  listUsers: async (req, res) => {
    try {
      const { role, status, search } = req.query;
      const filter = {};
      if (status && ["active", "suspended", "rejected"].includes(status)) {
        filter.status = status;
      }
      const userFilter = { ...filter };
      const managerFilter = { ...filter };
      if (search) {
        const rx = new RegExp(String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        userFilter.$or = [{ name: rx }, { email: rx }];
        managerFilter.$or = [{ name: rx }, { email: rx }];
      }
      // Role filter — "manager" routes to Manager collection; everything else
      // filters by the role field inside User. If no role specified, query both.
      let users = [];
      let managers = [];
      const wantManager = !role || String(role).toLowerCase() === "manager";
      const wantUser = !role || String(role).toLowerCase() !== "manager";
      if (wantUser) {
        const uf = { ...userFilter };
        if (role && String(role).toLowerCase() !== "manager") {
          uf.role = new RegExp(`^${role}$`, "i");
        }
        users = await User.find(uf)
          .select("name email role status suspensionReason suspendedAt suspendedBy")
          .limit(500)
          .lean();
      }
      if (wantManager) {
        managers = await Manager.find(managerFilter)
          .select("name email status suspensionReason suspendedAt suspendedBy")
          .limit(500)
          .lean();
      }
      const items = [
        ...users.map((u) => ({
          id: u._id,
          name: u.name,
          email: u.email,
          role: (u.role || "player").toLowerCase(),
          userType: (u.role || "player").toLowerCase(),
          status: u.status || "active",
          suspensionReason: u.suspensionReason || null,
          suspendedAt: u.suspendedAt || null,
          suspendedBy: u.suspendedBy || null,
        })),
        ...managers.map((m) => ({
          id: m._id,
          name: m.name,
          email: m.email,
          role: "manager",
          userType: "manager",
          status: m.status || "active",
          suspensionReason: m.suspensionReason || null,
          suspendedAt: m.suspendedAt || null,
          suspendedBy: m.suspendedBy || null,
        })),
      ].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

      return res.json({ success: true, total: items.length, items });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },
};

module.exports = rbacController;
