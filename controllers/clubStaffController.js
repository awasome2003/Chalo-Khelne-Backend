/**
 * Club Staff & Roles controller (Club OS). Tenant-scoped by clubId.
 * Role-default permission flags on create; per-flag toggling in the matrix.
 */
const ClubStaff = require("../src/modules/club/models/ClubStaff");
const { resolveClubId } = require("../src/modules/club/scope");
const { logClubAudit } = require("../src/modules/club/automation");

const today = () => new Date().toISOString().slice(0, 10);
const FIELDS = ["name", "role", "phone", "email", "shift", "salary"];

exports.list = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    const staff = await ClubStaff.find({ clubId }).sort({ createdAt: 1 }).lean();
    const stats = {
      total: staff.length,
      onDuty: staff.filter((s) => s.attendanceToday === "Present").length,
      payroll: staff.reduce((s, x) => s + (Number(x.salary) || 0), 0),
    };
    return res.json({ success: true, count: staff.length, staff, stats });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.create = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    if (!req.body.name || !String(req.body.name).trim()) return res.status(400).json({ success: false, message: "Staff name is required" });
    const payload = { clubId, createdBy: req.user?.id || null, attendanceToday: "Present", joiningDate: today() };
    for (const k of FIELDS) if (req.body[k] !== undefined) payload[k] = req.body[k];
    // Role-based default permissions (unless the caller supplied an explicit set).
    payload.permissions = req.body.permissions || ClubStaff.defaultPermissions(payload.role || "Reception");
    const member = await ClubStaff.create(payload);
    await logClubAudit(clubId, { action: "Admit Employee", module: "Staff", details: `Hired ${member.name} as ${member.role}` });
    return res.status(201).json({ success: true, staff: member });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.update = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const update = {};
    for (const k of FIELDS) if (req.body[k] !== undefined) update[k] = req.body[k];
    const member = await ClubStaff.findOneAndUpdate({ _id: req.params.staffId, clubId }, update, { new: true, runValidators: true });
    if (!member) return res.status(404).json({ success: false, message: "Staff not found" });
    return res.json({ success: true, staff: member });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.updateAttendance = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const { attendanceToday } = req.body;
    if (!["Present", "Absent", "Not Set"].includes(attendanceToday)) return res.status(400).json({ success: false, message: "Invalid attendance value" });
    const member = await ClubStaff.findOneAndUpdate({ _id: req.params.staffId, clubId }, { attendanceToday }, { new: true });
    if (!member) return res.status(404).json({ success: false, message: "Staff not found" });
    return res.json({ success: true, staff: member });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

// Replace the permission set (matrix toggle / reset-to-defaults).
exports.updatePermissions = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const perms = req.body.permissions;
    if (!perms || typeof perms !== "object") return res.status(400).json({ success: false, message: "permissions object is required" });
    const clean = {};
    for (const k of ClubStaff.PERMISSION_KEYS) clean[`permissions.${k}`] = !!perms[k];
    const member = await ClubStaff.findOneAndUpdate({ _id: req.params.staffId, clubId }, clean, { new: true });
    if (!member) return res.status(404).json({ success: false, message: "Staff not found" });
    await logClubAudit(clubId, { action: "Modify Permissions", module: "Staff", details: `Updated access for ${member.name}` });
    return res.json({ success: true, staff: member });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.remove = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const member = await ClubStaff.findOneAndDelete({ _id: req.params.staffId, clubId });
    if (!member) return res.status(404).json({ success: false, message: "Staff not found" });
    await logClubAudit(clubId, { action: "Terminate Staff", module: "Staff", details: `Removed ${member.name}` });
    return res.json({ success: true, message: "Staff removed" });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};
