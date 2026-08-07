/**
 * Club Coaches controller (Club OS). Tenant-scoped by clubId. Assigning a
 * session auto-posts a Staff Salary payroll expense + audit (cross-module).
 */
const ClubCoach = require("../src/modules/club/models/ClubCoach");
const { resolveClubId } = require("../src/modules/club/scope");
const { postClubFinance, logClubAudit } = require("../src/modules/club/automation");

const FIELDS = ["name", "sport", "availability", "hourlyRate", "rating", "status"];

exports.list = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    const coaches = await ClubCoach.find({ clubId }).sort({ createdAt: 1 }).lean();
    const stats = {
      total: coaches.length,
      available: coaches.filter((c) => c.attendanceToday === "Present" && c.status !== "On Leave").length,
      onLeave: coaches.filter((c) => c.status === "On Leave" || c.attendanceToday === "On Leave").length,
      payroll: coaches.reduce((s, c) => s + (Number(c.earnings) || 0), 0),
    };
    return res.json({ success: true, count: coaches.length, coaches, stats });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.create = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    if (!req.body.name || !String(req.body.name).trim()) return res.status(400).json({ success: false, message: "Coach name is required" });
    const payload = { clubId, createdBy: req.user?.id || null, attendanceToday: "Present" };
    for (const k of FIELDS) if (req.body[k] !== undefined) payload[k] = req.body[k];
    const coach = await ClubCoach.create(payload);
    await logClubAudit(clubId, { action: "Register Trainer", module: "Coaches", details: `Added coach ${coach.name}` });
    return res.status(201).json({ success: true, coach });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.update = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const update = {};
    for (const k of FIELDS) if (req.body[k] !== undefined) update[k] = req.body[k];
    const coach = await ClubCoach.findOneAndUpdate({ _id: req.params.coachId, clubId }, update, { new: true, runValidators: true });
    if (!coach) return res.status(404).json({ success: false, message: "Coach not found" });
    return res.json({ success: true, coach });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.updateAttendance = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const { attendanceToday } = req.body;
    if (!["Present", "Absent", "On Leave", "Not Set"].includes(attendanceToday)) {
      return res.status(400).json({ success: false, message: "Invalid attendance value" });
    }
    const update = { attendanceToday };
    if (attendanceToday === "On Leave") update.status = "On Leave";
    else if (attendanceToday === "Present") update.status = "Available";
    const coach = await ClubCoach.findOneAndUpdate({ _id: req.params.coachId, clubId }, update, { new: true });
    if (!coach) return res.status(404).json({ success: false, message: "Coach not found" });
    return res.json({ success: true, coach });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

// Assign a coaching session → bump sessions + earnings, post a payroll expense.
exports.assignSession = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const coach = await ClubCoach.findOne({ _id: req.params.coachId, clubId });
    if (!coach) return res.status(404).json({ success: false, message: "Coach not found" });
    const amount = Number(req.body.amount);
    const pay = Number.isFinite(amount) && amount >= 0 ? amount : (Number(coach.hourlyRate) || 0);
    coach.sessionsCount += 1;
    coach.earnings += pay;
    await coach.save();
    await logClubAudit(clubId, { action: "Assign Session", module: "Coaches", details: `Session for ${coach.name} (payout ${pay})` });
    if (pay > 0) await postClubFinance(clubId, { type: "Expense", category: "Staff Salary", amount: pay, paymentMethod: "NetBanking", description: `Coaching session payout — ${coach.name}`, sourceType: "coach", sourceId: coach._id, createdBy: req.user?.id || null, withGst: false });
    return res.json({ success: true, coach });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.remove = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const coach = await ClubCoach.findOneAndDelete({ _id: req.params.coachId, clubId });
    if (!coach) return res.status(404).json({ success: false, message: "Coach not found" });
    await logClubAudit(clubId, { action: "Deactivate Coach", module: "Coaches", details: `Removed coach ${coach.name}` });
    return res.json({ success: true, message: "Coach removed" });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};
