const express = require("express");
const router = express.Router();
const { allowUserOrManager } = require("../middleware/authMiddleware");
const TrainingSchedule = require("../src/modules/coaching/models/TrainingSchedule");
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

// POST /api/training-schedule — add a row (admin).
router.post("/", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await resolveSchoolOrg(req, res);
    if (!clubId) return;
    const { day, standard, time, sports } = req.body;
    if (!day || !String(day).trim()) return res.status(400).json({ error: "Day is required." });
    const count = await TrainingSchedule.countDocuments({ clubId });
    const row = await TrainingSchedule.create({
      clubId,
      day: String(day).trim(),
      standard: String(standard || "").trim(),
      time: String(time || "").trim(),
      sports: cleanSports(sports),
      order: count,
    });
    res.status(201).json({ success: true, row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/training-schedule/:id — edit a row (admin).
router.put("/:id", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await resolveSchoolOrg(req, res);
    if (!clubId) return;
    const row = await TrainingSchedule.findOne({ _id: req.params.id, clubId });
    if (!row) return res.status(404).json({ error: "Row not found." });
    const { day, standard, time, sports } = req.body;
    if (day !== undefined) row.day = String(day).trim();
    if (standard !== undefined) row.standard = String(standard).trim();
    if (time !== undefined) row.time = String(time).trim();
    if (sports !== undefined) row.sports = cleanSports(sports);
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

module.exports = router;
