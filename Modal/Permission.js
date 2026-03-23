const mongoose = require("mongoose");

const permissionSchema = new mongoose.Schema(
  {
    // Unique permission key: module:action (e.g., "tournament:create", "turf:delete")
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^[a-z_]+:[a-z_]+$/, "Permission key must be in format module:action"],
    },

    // Human-readable name
    name: {
      type: String,
      required: true,
      trim: true,
    },

    // Description of what this permission allows
    description: {
      type: String,
      trim: true,
      default: "",
    },

    // Module this permission belongs to
    module: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      enum: [
        "tournament",
        "turf",
        "booking",
        "player",
        "manager",
        "club_admin",
        "trainer",
        "news",
        "social",
        "payment",
        "donation",
        "expense",
        "referee",
        "notification",
        "report",
        "settings",
        "sport",
        "staff",
        "role",
      ],
    },

    // Action type
    action: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      enum: [
        "create",
        "read",
        "update",
        "delete",
        "manage",    // full CRUD
        "approve",
        "reject",
        "publish",
        "assign",
        "export",
        "view_all",  // cross-scope visibility
        "view_own",  // own scope only
      ],
    },

    // Whether this is a system permission (cannot be deleted)
    isSystem: {
      type: Boolean,
      default: false,
    },

    // Active status
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

permissionSchema.index({ module: 1, action: 1 });
permissionSchema.index({ isActive: 1 });

module.exports = mongoose.model("Permission", permissionSchema);
