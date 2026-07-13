const express = require("express");
const router = express.Router();
const { allowUserOrManager } = require("../middleware/authMiddleware");
const TrainingSchedule = require("../src/modules/coaching/models/TrainingSchedule");
const SessionOverride = require("../src/modules/coaching/models/SessionOverride");
const ClubSport = require("../src/modules/org/models/ClubSport");
const ClubAdminProfile = require("../src/modules/org/models/ClubAdminProfile");
const { effectiveTrainer } = require("../utils/trainerScope");

// Only a school / organization admin manages the schedule.
async function resolveSchoolOrg(req, res) {
  const u = req.user;
  if (!u || (u.role !== "ClubAdmin" && u.role !== "corporate_admin")) {
    res.status(403).json({ error: "Only a school or organization admin can manage the schedule." });
    return null;
  }
  const clubId = String(u._id);
  const profile = await ClubAdminProfile.findOne({ userId: clubId }).select("orgType").lean();
  const orgType = profile?.orgType || "club";
  if (orgType !== "school" && orgType !== "organization") {
    res.status(403).json({ error: "Only school or organization admins can manage the schedule." });
    return null;
  }
  return clubId;
}

const cleanSports = (raw) =>
  (Array.isArray(raw) ? raw : String(raw || "").split(","))
    .map((s) => String(s).trim())
    .filter(Boolean);

// GET /api/training-schedule — full schedule (admin).
router.get("/", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await resolveSchoolOrg(req, res);
    if (!clubId) return;
    const rows = await TrainingSchedule.find({ clubId }).sort({ order: 1, createdAt: 1 }).lean();
    res.json({ success: true, rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/training-schedule/mine — the logged-in trainer's slots (rows that
// include any of the sports they are assigned to).
router.get("/mine", allowUserOrManager, async (req, res) => {
  try {
    const eff = effectiveTrainer(req); // substitute → the coach
    if (!eff || !eff.trainerId) return res.json({ success: true, rows: [] });
    const me = eff.trainerId;
    const clubId = eff.clubId;
    const assigned = await ClubSport.find({ clubId, "trainers.trainer": me }).select("name").lean();
    const sportNames = assigned.map((s) => s.name);
    if (sportNames.length === 0) return res.json({ success: true, rows: [], sports: [] });
    const rows = await TrainingSchedule.find({ clubId, sports: { $in: sportNames } })
      .sort({ order: 1, createdAt: 1 })
      .lean();
    // Attach which of the trainer's sports apply to each row.
    const decorated = rows.map((r) => ({
      ...r,
      mySports: (r.sports || []).filter((s) => sportNames.includes(s)),
    }));
    res.json({ success: true, rows: decorated, sports: sportNames });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Display "16:00 - 17:00" from start/end when no explicit display string given.
const deriveTime = (time, startTime, endTime) => {
  const t = String(time || "").trim();
  if (t) return t;
  if (startTime && endTime) return `${startTime} - ${endTime}`;
  return "";
};

// POST /api/training-schedule — add a row (admin).
router.post("/", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await resolveSchoolOrg(req, res);
    if (!clubId) return;
    const {
      day, standard, section, time, startTime, endTime,
      sport, sports, coach, coachName, ground,
    } = req.body;
    if (!day || !String(day).trim()) return res.status(400).json({ error: "Day is required." });
    const singleSport = String(sport || "").trim();
    const sportsArr = singleSport ? [singleSport] : cleanSports(sports);
    const count = await TrainingSchedule.countDocuments({ clubId });
    const row = await TrainingSchedule.create({
      clubId,
      day: String(day).trim(),
      standard: String(standard || "").trim(),
      section: String(section || "").trim(),
      time: deriveTime(time, startTime, endTime),
      startTime: String(startTime || "").trim(),
      endTime: String(endTime || "").trim(),
      sport: singleSport,
      sports: sportsArr,
      coach: coach || null,
      coachName: String(coachName || "").trim(),
      ground: String(ground || "").trim(),
      order: count,
    });
    res.status(201).json({ success: true, row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/training-schedule/:id — edit a row (admin). Also covers "Reassign
// Coach" (permanent coach change) — just send { coach, coachName }.
router.put("/:id", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await resolveSchoolOrg(req, res);
    if (!clubId) return;
    const row = await TrainingSchedule.findOne({ _id: req.params.id, clubId });
    if (!row) return res.status(404).json({ error: "Row not found." });
    const b = req.body;
    if (b.day !== undefined) row.day = String(b.day).trim();
    if (b.standard !== undefined) row.standard = String(b.standard).trim();
    if (b.section !== undefined) row.section = String(b.section).trim();
    if (b.startTime !== undefined) row.startTime = String(b.startTime).trim();
    if (b.endTime !== undefined) row.endTime = String(b.endTime).trim();
    if (b.ground !== undefined) row.ground = String(b.ground).trim();
    if (b.coach !== undefined) row.coach = b.coach || null;
    if (b.coachName !== undefined) row.coachName = String(b.coachName).trim();
    if (b.sport !== undefined) {
      row.sport = String(b.sport).trim();
      row.sports = row.sport ? [row.sport] : [];
    } else if (b.sports !== undefined) {
      row.sports = cleanSports(b.sports);
    }
    // Keep the display time in sync.
    if (b.time !== undefined) row.time = String(b.time).trim();
    else if (b.startTime !== undefined || b.endTime !== undefined) {
      row.time = deriveTime("", row.startTime, row.endTime);
    }
    await row.save();
    res.json({ success: true, row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/training-schedule/:id — remove a row (admin).
router.delete("/:id", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await resolveSchoolOrg(req, res);
    if (!clubId) return;
    const r = await TrainingSchedule.deleteOne({ _id: req.params.id, clubId });
    if (r.deletedCount === 0) return res.status(404).json({ error: "Row not found." });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Per-date Cancel / Postpone overrides ──────────────────────────────

// GET /api/training-schedule/overrides?from=YYYY-MM-DD&to=YYYY-MM-DD
// Overrides for the admin to overlay on the weekly view.
router.get("/overrides", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await resolveSchoolOrg(req, res);
    if (!clubId) return;
    const { from, to } = req.query;
    const q = { clubId };
    if (from || to) {
      q.date = {};
      if (from) q.date.$gte = String(from);
      if (to) q.date.$lte = String(to);
    }
    const overrides = await SessionOverride.find(q).lean();
    res.json({ success: true, overrides });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/training-schedule/:id/override — cancel or postpone one dated session.
router.post("/:id/override", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await resolveSchoolOrg(req, res);
    if (!clubId) return;
    const slot = await TrainingSchedule.findOne({ _id: req.params.id, clubId }).lean();
    if (!slot) return res.status(404).json({ error: "Schedule slot not found." });
    const { date, status, newDay, newStartTime, newEndTime, reason, note } = req.body;
    if (!date || !String(date).trim()) return res.status(400).json({ error: "Date is required." });
    if (!["cancelled", "postponed"].includes(status)) {
      return res.status(400).json({ error: "status must be 'cancelled' or 'postponed'." });
    }
    const override = await SessionOverride.findOneAndUpdate(
      { clubId, scheduleId: slot._id, date: String(date).trim() },
      {
        clubId,
        scheduleId: slot._id,
        date: String(date).trim(),
        status,
        newDay: String(newDay || "").trim(),
        newStartTime: String(newStartTime || "").trim(),
        newEndTime: String(newEndTime || "").trim(),
        reason: String(reason || "").trim(),
        note: String(note || "").trim(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, override });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/training-schedule/:id/override?date=YYYY-MM-DD — restore a session.
router.delete("/:id/override", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await resolveSchoolOrg(req, res);
    if (!clubId) return;
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "date query param required." });
    await SessionOverride.deleteOne({ clubId, scheduleId: req.params.id, date: String(date) });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
