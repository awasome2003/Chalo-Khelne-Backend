/**
 * Additive RBAC seed for the IONIX Sports Events — Event OS.
 * Adds Event-OS permissions + the new agency/staff roles WITHOUT touching the
 * existing seedRbac.js roles. Idempotent (upsert by key/slug).
 *
 * Run: node _runSeedEventOsRbac.js
 */
const Permission = require("../src/modules/identity/models/Permission");
const Role = require("../src/modules/identity/models/Role");

// ── New Event-OS permissions ──
const EVENT_OS_PERMISSIONS = [
  { key: "agency:admin", name: "Agency-wide Admin", module: "agency", action: "admin" },
  { key: "client:manage", name: "Onboard/Monitor Clubs, Schools, Corporates", module: "agency", action: "client_manage" },
  { key: "event:create", name: "Create Event", module: "event", action: "create" },
  { key: "event:read", name: "View Events", module: "event", action: "read" },
  { key: "event:update", name: "Edit Event", module: "event", action: "update" },
  { key: "event:delete", name: "Delete Event", module: "event", action: "delete" },
  { key: "event:manage", name: "Manage Event (tasks/staff/venues/timeline)", module: "event", action: "manage" },
  { key: "eventstaff:manage", name: "Manage Event Staff", module: "eventstaff", action: "manage" },
  { key: "eventstaff:self", name: "Self Check-in / See Own Assignment", module: "eventstaff", action: "self" },
  { key: "equipment:manage", name: "Manage Event Equipment Log", module: "equipment", action: "manage" },
  { key: "sponsor:manage", name: "Manage Sponsors", module: "sponsor", action: "manage" },
  { key: "finance:manage", name: "Manage Event Finances", module: "finance", action: "manage" },
];

// ── New roles (office = web, field staff = mobile) ──
const OFFICE = "web";
const FIELD = "mobile";

const EVENT_OS_ROLES = [
  {
    name: "Agency Admin", slug: "agency_admin", authorityLevel: 1, surface: OFFICE,
    description: "IONIX agency owner. Full Event-OS access across all events, staff, clients and finance.",
    color: "#10B981", icon: "sparkles", isSystem: true,
    permissionKeys: [
      "agency:admin", "client:manage", "role:manage",
      "event:create", "event:read", "event:update", "event:delete", "event:manage",
      "eventstaff:manage", "equipment:manage", "sponsor:manage", "finance:manage",
      "tournament:create", "tournament:manage", "tournament:read", "tournament:update", "tournament:delete", "tournament:score", "tournament:export", "tournament:bulk_register",
      "referee:assign", "referee:read",
      "booking:read", "booking:approve", "payment:read", "payment:approve",
      "expense:read", "expense:create", "report:view_all",
    ],
  },
  {
    name: "Event Manager", slug: "event_manager", authorityLevel: 2, surface: OFFICE,
    description: "Runs assigned events end-to-end: staff, officials, equipment, registrations.",
    color: "#2563EB", icon: "calendar", isSystem: true,
    permissionKeys: [
      "event:create", "event:read", "event:update", "event:delete", "event:manage",
      "eventstaff:manage", "equipment:manage", "sponsor:manage",
      "tournament:create", "tournament:manage", "tournament:read", "tournament:update", "tournament:score", "tournament:export", "tournament:bulk_register",
      "referee:assign", "referee:read",
      "booking:read", "booking:approve", "report:view_all",
    ],
  },
  {
    name: "Coordinator", slug: "coordinator", authorityLevel: 3, surface: OFFICE,
    description: "Event operations coordinator: staff attendance, equipment, registrations.",
    color: "#F59E0B", icon: "clipboard-check", isSystem: true,
    permissionKeys: [
      "event:read", "eventstaff:manage", "equipment:manage", "booking:read", "booking:approve",
    ],
  },
  // Field staff — mobile check-in / own assignment only
  { name: "Volunteer", slug: "volunteer", authorityLevel: 4, surface: FIELD, description: "Event volunteer.", color: "#64748B", icon: "user", isSystem: true, permissionKeys: ["eventstaff:self", "event:read"] },
  { name: "Photographer", slug: "photographer", authorityLevel: 4, surface: FIELD, description: "Event photographer.", color: "#8B5CF6", icon: "camera", isSystem: true, permissionKeys: ["eventstaff:self", "event:read"] },
  { name: "Commentator", slug: "commentator", authorityLevel: 4, surface: FIELD, description: "Match commentator.", color: "#EC4899", icon: "mic", isSystem: true, permissionKeys: ["eventstaff:self", "event:read"] },
  { name: "Ground Staff", slug: "ground_staff", authorityLevel: 4, surface: FIELD, description: "Venue/ground staff.", color: "#65A30D", icon: "shovel", isSystem: true, permissionKeys: ["eventstaff:self", "event:read"] },
  { name: "Security", slug: "security", authorityLevel: 4, surface: FIELD, description: "Event security.", color: "#DC2626", icon: "shield", isSystem: true, permissionKeys: ["eventstaff:self", "event:read"] },
  { name: "Medical", slug: "medical", authorityLevel: 4, surface: FIELD, description: "Medical / first-aid staff.", color: "#EF4444", icon: "activity", isSystem: true, permissionKeys: ["eventstaff:self", "event:read"] },
];

async function seedEventOsRbac(res = null) {
  let permsCreated = 0, permsSkipped = 0, rolesCreated = 0, rolesUpdated = 0;
  try {
    // Step 1: upsert permissions
    const permMap = {};
    for (const p of EVENT_OS_PERMISSIONS) {
      let ex = await Permission.findOne({ key: p.key });
      if (ex) { permsSkipped++; permMap[p.key] = ex._id; }
      else { const c = await Permission.create({ ...p, isSystem: true }); permsCreated++; permMap[p.key] = c._id; }
    }
    // resolve permission ids for keys that may live in the base seed too
    const resolveKey = async (k) => {
      if (permMap[k]) return permMap[k];
      const ex = await Permission.findOne({ key: k });
      return ex ? ex._id : null;
    };

    // Step 2: upsert roles
    for (const r of EVENT_OS_ROLES) {
      const permIds = (await Promise.all(r.permissionKeys.map(resolveKey))).filter(Boolean);
      let ex = await Role.findOne({ slug: r.slug });
      if (ex) {
        ex.permissions = permIds; ex.description = r.description; ex.color = r.color;
        ex.icon = r.icon; ex.surface = r.surface; ex.authorityLevel = r.authorityLevel;
        await ex.save(); rolesUpdated++;
      } else {
        await Role.create({
          name: r.name, slug: r.slug, authorityLevel: r.authorityLevel, surface: r.surface,
          description: r.description, color: r.color, icon: r.icon, isSystem: r.isSystem, permissions: permIds,
        });
        rolesCreated++;
      }
    }

    const summary = {
      permissions: { created: permsCreated, skipped: permsSkipped, total: EVENT_OS_PERMISSIONS.length },
      roles: { created: rolesCreated, updated: rolesUpdated, total: EVENT_OS_ROLES.length },
    };
    console.log("[EVENT_OS_RBAC] Complete:", JSON.stringify(summary));
    if (res) return res.json({ success: true, ...summary });
    return summary;
  } catch (err) {
    console.error("[EVENT_OS_RBAC] Error:", err.message);
    if (res) return res.status(500).json({ success: false, message: err.message });
    throw err;
  }
}

module.exports = seedEventOsRbac;
