const express = require("express");
const router = express.Router();
const { allowUserOrManager } = require("../middleware/authMiddleware");
const LeaveRequest = require("../src/modules/coaching/models/LeaveRequest");
const ClubAdminProfile = require("../src/modules/org/models/ClubAdminProfile");
const { Manager } = require("../src/modules/identity/models/ClubManager");
const { effectiveTrainer } = require("../utils/trainerScope");

// School / organization admin gate (returns clubId or null after replying).
async function resolveSchoolOrg(req, res) {
  const u = req.user;
  if (!u || (u.role !== "ClubAdmin" && u.role !== "corporate_admin")) {
    res.status(403).json({ error: "Only a school or organization admin can do this." });
    return null;
  }
  const clubId = String(u._id);
  const profile = await ClubAdminProfile.findOne({ userId: clubId }).select("orgType").lean();
  const orgType = profile?.orgType || "club";
  if (orgType !== "school" && orgType !== "organization") {
    res.status(403).json({ error: "Only school or organization admins." });
    return null;
  }
  return clubId;
}

// POST /api/leave-requests — a coach applies for leave (mobile/coach side).
router.post("/", allowUserOrManager, async (req, res) => {
  try {
    const eff = effectiveTrainer(req);
    if (!eff || !eff.trainerId) return res.status(403).json({ error: "Only a coach can apply for leave." });
    const { fromDate, toDate, reason } = req.body;
    if (!fromDate || !toDate) return res.status(400).json({ error: "From and to dates are required." });
    const mgr = await Manager.findById(eff.trainerId).select("name").lean();
    const leave = await LeaveRequest.create({
      clubId: eff.clubId,
      coach: eff.trainerId,
      coachName: mgr?.name || "",
      fromDate: String(fromDate).trim(),
      toDate: String(toDate).trim(),
      reason: String(reason || "").trim(),
      status: "pending",
    });
    res.status(201).json({ success: true, leave });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leave-requests — admin lists all (filter by status); a coach gets own.
router.get("/", allowUserOrManager, async (req, res) => {
  try {
    const eff = effectiveTrainer(req);
    if (eff && eff.trainerId && req.userRole === "Manager") {
      const mine = await LeaveRequest.find({ clubId: eff.clubId, coach: eff.trainerId })
        .sort({ createdAt: -1 }).lean();
      return res.json({ success: true, leaves: mine });
    }
    const clubId = await resolveSchoolOrg(req, res);
    if (!clubId) return;
    const q = { clubId };
    if (req.query.status) q.status = req.query.status;
    const leaves = await LeaveRequest.find(q).sort({ createdAt: -1 }).lean();
    res.json({ success: true, leaves });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/leave-requests/:id — admin approve / reject.
router.patch("/:id", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await resolveSchoolOrg(req, res);
    if (!clubId) return;
    const { status, adminNote } = req.body;
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "status must be 'approved' or 'rejected'." });
    }
    const leave = await LeaveRequest.findOne({ _id: req.params.id, clubId });
    if (!leave) return res.status(404).json({ error: "Leave request not found." });
    leave.status = status;
    if (adminNote !== undefined) leave.adminNote = String(adminNote).trim();
    await leave.save();
    res.json({ success: true, leave });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
