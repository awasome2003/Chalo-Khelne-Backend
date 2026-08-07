const mongoose = require("mongoose");

/**
 * ClubStaff — a non-coaching staff member of a facility Club (Club OS).
 * Tenant-scoped by clubId. Role-based permission flags + daily attendance.
 */
const STAFF_ROLES = ["Manager", "Reception", "Ground Staff", "Scorer", "Cameraman", "Referee Coordinator", "Security", "Cleaner"];
const SHIFTS = ["Morning", "Evening", "Night", "Full Day"];
const PERMISSION_KEYS = ["bookings", "membership", "finance", "reports", "maintenance", "courtStatus", "payments", "sessions"];

const clubStaffSchema = new mongoose.Schema(
  {
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: STAFF_ROLES, default: "Reception" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    shift: { type: String, enum: SHIFTS, default: "Morning" },
    salary: { type: Number, default: 0, min: 0 },
    joiningDate: { type: String, default: "" },
    permissions: {
      bookings: { type: Boolean, default: false },
      membership: { type: Boolean, default: false },
      finance: { type: Boolean, default: false },
      reports: { type: Boolean, default: false },
      maintenance: { type: Boolean, default: false },
      courtStatus: { type: Boolean, default: false },
      payments: { type: Boolean, default: false },
      sessions: { type: Boolean, default: false },
    },
    attendanceToday: { type: String, enum: ["Present", "Absent", "Not Set"], default: "Not Set" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

clubStaffSchema.index({ clubId: 1, createdAt: 1 });

// Sensible default permissions per role (mirrors the prototype's matrix).
clubStaffSchema.statics.defaultPermissions = (role) => ({
  bookings: ["Manager", "Reception", "Referee Coordinator"].includes(role),
  membership: ["Manager", "Reception"].includes(role),
  finance: role === "Manager",
  reports: role === "Manager",
  maintenance: ["Manager", "Ground Staff"].includes(role),
  courtStatus: ["Manager", "Reception", "Ground Staff"].includes(role),
  payments: ["Manager", "Reception"].includes(role),
  sessions: ["Manager", "Referee Coordinator"].includes(role),
});

module.exports = mongoose.model("ClubStaff", clubStaffSchema);
module.exports.STAFF_ROLES = STAFF_ROLES;
module.exports.SHIFTS = SHIFTS;
module.exports.PERMISSION_KEYS = PERMISSION_KEYS;
