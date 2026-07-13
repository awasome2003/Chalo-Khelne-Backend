const express = require("express");
const router = express.Router();
const { allowUserOrManager } = require("../middleware/authMiddleware");
const SessionChangeRequest = require("../src/modules/coaching/models/SessionChangeRequest");
const SessionOverride = require("../src/modules/coaching/models/SessionOverride");
const TrainingSchedule = require("../src/modules/coaching/models/TrainingSchedule");
const ClubAdminProfile = require("../src/modules/org/models/ClubAdminProfile");
const { Manager } = require("../src/modules/identity/models/ClubManager");
const { effectiveTrainer } = require("../utils/trainerScope");

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

// POST /api/session-requests — a coach requests a session change.
router.post("/", allowUserOrManager, async (req, res) => {
  try {
    const eff = effectiveTrainer(req);
    if (!eff || !eff.trainerId) return res.status(403).json({ error: "Only a coach can request a change." });
    const { scheduleId, date, requestType, reason, proposedNewDay, proposedNewStartTime, proposedNewEndTime } = req.body;
    if (!scheduleId || !date || !requestType) {
      return res.status(400).json({ error: "scheduleId, date and requestType are required." });
    }
    if (!["postpone", "cancel", "reschedule"].includes(requestType)) {
      return res.status(400).json({ error: "Invalid requestType." });
    }
    const slot = await TrainingSchedule.findOne({ _id: scheduleId, clubId: eff.clubId }).lean();
    if (!slot) return res.status(404).json({ error: "Session not found." });
    const mgr = await Manager.findById(eff.trainerId).select("name").lean();
    const request = await SessionChangeRequest.create({
      clubId: eff.clubId,
      scheduleId,
      coach: eff.trainerId,
      coachName: mgr?.name || "",
      date: String(date).trim(),
      requestType,
      reason: reason || "",
      proposedNewDay: proposedNewDay || "",
      proposedNewStartTime: proposedNewStartTime || "",
      proposedNewEndTime: proposedNewEndTime || "",
      sport: slot.sport || (slot.sports || []).join(", "),
      standard: slot.standard || "",
      section: slot.section || "",
      status: "pending",
    });
    res.status(201).json({ success: true, request });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/session-requests — admin lists (filter status/reason); coach gets own.
router.get("/", allowUserOrManager, async (req, res) => {
  try {
    const eff = effectiveTrainer(req);
    if (eff && eff.trainerId && req.userRole === "Manager") {
      const mine = await SessionChangeRequest.find({ clubId: eff.clubId, coach: eff.trainerId })
        .sort({ createdAt: -1 }).lean();
      return res.json({ success: true, requests: mine });
    }
    const clubId = await resolveSchoolOrg(req, res);
    if (!clubId) return;
    const q = { clubId };
    if (req.query.status) q.status = req.query.status;
    if (req.query.reason) q.reason = req.query.reason;
    const requests = await SessionChangeRequest.find(q).sort({ createdAt: -1 }).lean();
    res.json({ success: true, requests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/session-requests/:id — admin action.
// body: { action: "approve"|"reject"|"reschedule"|"assign_coach", adminNote?,
//         newDay?, newStartTime?, newEndTime?, coach? }
router.patch("/:id", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await resolveSchoolOrg(req, res);
    if (!clubId) return;
    const reqDoc = await SessionChangeRequest.findOne({ _id: req.params.id, clubId });
    if (!reqDoc) return res.status(404).json({ error: "Request not found." });
    const { action, adminNote, newDay, newStartTime, newEndTime, coach } = req.body;

    if (action === "reject") {
      reqDoc.status = "rejected";
    } else if (action === "assign_coach") {
      const slot = await TrainingSchedule.findOne({ _id: reqDoc.scheduleId, clubId });
      if (slot) {
        const mgr = coach ? await Manager.findById(coach).select("name").lean() : null;
        slot.coach = coach || null;
        slot.coachName = mgr?.name || "";
        await slot.save();
      }
      reqDoc.status = "approved";
    } else if (action === "approve" || action === "reschedule") {
      if (reqDoc.requestType === "cancel" && action === "approve") {
        await SessionOverride.findOneAndUpdate(
          { clubId, scheduleId: reqDoc.scheduleId, date: reqDoc.date },
          { clubId, scheduleId: reqDoc.scheduleId, date: reqDoc.date, status: "cancelled", reason: reqDoc.reason },
          { upsert: true, setDefaultsOnInsert: true }
        );
      } else {
        await SessionOverride.findOneAndUpdate(
          { clubId, scheduleId: reqDoc.scheduleId, date: reqDoc.date },
          {
            clubId, scheduleId: reqDoc.scheduleId, date: reqDoc.date, status: "postponed",
            newDay: newDay || reqDoc.proposedNewDay || "",
            newStartTime: newStartTime || reqDoc.proposedNewStartTime || "",
            newEndTime: newEndTime || reqDoc.proposedNewEndTime || "",
            reason: reqDoc.reason,
          },
          { upsert: true, setDefaultsOnInsert: true }
        );
      }
      reqDoc.status = "approved";
    } else {
      return res.status(400).json({ error: "Unknown action." });
    }

    if (adminNote !== undefined) reqDoc.adminNote = String(adminNote).trim();
    await reqDoc.save();
    res.json({ success: true, request: reqDoc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
