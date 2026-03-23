const Role = require("../Modal/Role");
const Permission = require("../Modal/Permission");
const mongoose = require("mongoose");

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
};

module.exports = rbacController;
