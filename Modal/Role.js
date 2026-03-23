const mongoose = require("mongoose");

const roleSchema = new mongoose.Schema(
  {
    // Unique role name
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    // Slug for programmatic use (e.g., "super_admin", "club_admin")
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^[a-z_]+$/, "Slug must be lowercase with underscores only"],
    },

    // Authority level — lower number = higher authority
    // SuperAdmin(0) > ClubAdmin(1) > Manager(2) > Trainer(3) > Player(4) > Team(5)
    authorityLevel: {
      type: Number,
      required: true,
      min: 0,
      max: 99,
    },

    // Description
    description: {
      type: String,
      trim: true,
      default: "",
    },

    // Permissions assigned to this role
    permissions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Permission",
      },
    ],

    // Whether this is a system role (cannot be deleted/renamed)
    isSystem: {
      type: Boolean,
      default: false,
    },

    // Active status
    isActive: {
      type: Boolean,
      default: true,
    },

    // Color for UI display
    color: {
      type: String,
      default: "#6B7280",
    },

    // Icon name for UI
    icon: {
      type: String,
      default: "user",
    },
  },
  {
    timestamps: true,
  }
);

roleSchema.index({ authorityLevel: 1 });
roleSchema.index({ slug: 1 });

// Virtual: check if role has a specific permission
roleSchema.methods.hasPermission = async function (permissionKey) {
  await this.populate("permissions");
  return this.permissions.some(
    (p) => p.key === permissionKey && p.isActive
  );
};

// Virtual: get all permission keys as array
roleSchema.methods.getPermissionKeys = async function () {
  await this.populate("permissions");
  return this.permissions
    .filter((p) => p.isActive)
    .map((p) => p.key);
};

module.exports = mongoose.model("Role", roleSchema);
