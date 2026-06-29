const express = require("express");
const router = express.Router();
const { allowUserOrManager } = require("../middleware/authMiddleware");
const SportsSyllabus = require("../src/modules/coaching/models/SportsSyllabus");
const SyllabusEntry = require("../src/modules/coaching/models/SyllabusEntry");
const ClubSport = require("../src/modules/org/models/ClubSport");
const TrainingSchedule = require("../src/modules/coaching/models/TrainingSchedule");
const ClubAdminProfile = require("../src/modules/org/models/ClubAdminProfile");
const { tenantMatchStage } = require("../utils/tenantContext");
const { effectiveTrainer } = require("../utils/trainerScope");

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

async function resolveSchoolOrgAdmin(req, res) {
  const u = req.user;
  if (!u || (u.role !== "ClubAdmin" && u.role !== "corporate_admin")) {
    res.status(403).json({ error: "School or organization admin access required." });
    return null;
  }
  const clubId = String(u._id);
  const profile = await ClubAdminProfile.findOne({ userId: clubId }).select("orgType").lean();
  const orgType = profile?.orgType || "club";
  if (orgType !== "school" && orgType !== "organization") {
    res.status(403).json({ error: "School or organization admin access required." });
    return null;
  }
  return clubId;
}

// ── Admin: list existing syllabi (sport+standard) with entry counts ──
router.get("/", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await resolveSchoolOrgAdmin(req, res);
    if (!clubId) return;
    const syllabi = await SportsSyllabus.find({ clubId }).sort({ sport: 1, standard: 1 }).lean();
    const counts = await SyllabusEntry.aggregate([
      ...tenantMatchStage(), // scope to caller's club (replaces inline clubId match)
      { $group: { _id: { sport: "$sport", standard: "$standard" }, count: { $sum: 1 } } },
    ]);
    const countMap = {};
    counts.forEach((c) => { countMap[`${c._id.sport}|${c._id.standard}`] = c.count; });
    res.json({
      success: true,
      syllabi: syllabi.map((s) => ({ ...s, count: countMap[`${s.sport}|${s.standard}`] || 0 })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: list entries for a (sport, standard) ──
router.get("/entries", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await resolveSchoolOrgAdmin(req, res);
    if (!clubId) return;
    const sport = String(req.query.sport || "").trim();
    const standard = String(req.query.standard || "").trim();
    const entries = await SyllabusEntry.find({ clubId, sport, standard }).sort({ weekNumber: 1, order: 1 }).lean();
    res.json({ success: true, entries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: add an entry (auto-creates the syllabus container) ──
router.post("/entries", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await resolveSchoolOrgAdmin(req, res);
    if (!clubId) return;
    const sport = String(req.body.sport || "").trim();
    const standard = String(req.body.standard || "").trim();
    const topic = String(req.body.topic || "").trim();
    if (!sport) return res.status(400).json({ error: "Sport is required." });
    if (!topic) return res.status(400).json({ error: "Topic is required." });

    let syllabus = await SportsSyllabus.findOne({ clubId, sport, standard });
    if (!syllabus) syllabus = await SportsSyllabus.create({ clubId, sport, standard, createdBy: clubId });

    const count = await SyllabusEntry.countDocuments({ clubId, sport, standard });
    const entry = await SyllabusEntry.create({
      syllabusId: syllabus._id, clubId, sport, standard,
      weekNumber: Number(req.body.weekNumber) > 0 ? Math.floor(Number(req.body.weekNumber)) : count + 1,
      order: count,
      topic,
      objectives: String(req.body.objectives || "").trim(),
      activities: String(req.body.activities || "").trim(),
      equipment: String(req.body.equipment || "").trim(),
      notes: String(req.body.notes || "").trim(),
    });
    res.status(201).json({ success: true, entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: edit an entry ──
router.put("/entries/:id", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await resolveSchoolOrgAdmin(req, res);
    if (!clubId) return;
    const entry = await SyllabusEntry.findOne({ _id: req.params.id, clubId });
    if (!entry) return res.status(404).json({ error: "Entry not found." });
    ["topic", "objectives", "activities", "equipment", "notes"].forEach((k) => {
      if (req.body[k] !== undefined) entry[k] = String(req.body[k]).trim();
    });
    if (req.body.weekNumber !== undefined && Number(req.body.weekNumber) > 0) {
      entry.weekNumber = Math.floor(Number(req.body.weekNumber));
    }
    await entry.save();
    res.json({ success: true, entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: delete an entry ──
router.delete("/entries/:id", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await resolveSchoolOrgAdmin(req, res);
    if (!clubId) return;
    const r = await SyllabusEntry.deleteOne({ _id: req.params.id, clubId });
    if (!r.deletedCount) return res.status(404).json({ error: "Entry not found." });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Coach / substitute: my syllabus (grouped by sport+standard, + today) ──
router.get("/mine", allowUserOrManager, async (req, res) => {
  try {
    const eff = effectiveTrainer(req); // substitute → the coach
    if (!eff || !eff.trainerId) return res.json({ success: true, combos: [], today: [] });
    const { trainerId, clubId } = eff;

    const assigned = await ClubSport.find({ clubId, "trainers.trainer": trainerId }).select("name").lean();
    const sportNames = assigned.map((s) => s.name);
    if (!sportNames.length) return res.json({ success: true, combos: [], today: [] });

    // Pull the timetable (for the TODAY flag + time) and every syllabus entry
    // the admin authored for any sport this coach is assigned to. Combos come
    // from the UNION of both — so a syllabus shows even if that exact standard
    // isn't on the timetable, and a scheduled class shows even with no syllabus.
    const [schedule, allEntries] = await Promise.all([
      TrainingSchedule.find({ clubId, sports: { $in: sportNames } })
        .select("day standard sports time").lean(),
      SyllabusEntry.find({ clubId, sport: { $in: sportNames } })
        .sort({ weekNumber: 1, order: 1 }).lean(),
    ]);
    const todayName = WEEKDAYS[new Date().getDay()];

    const comboMap = {};
    const ensure = (sport, standard) => {
      const key = `${sport}|${standard || ""}`;
      if (!comboMap[key]) comboMap[key] = { sport, standard: standard || "", isToday: false, time: "", entries: [] };
      return comboMap[key];
    };

    // From the timetable → gives us TODAY + time.
    schedule.forEach((r) => {
      (r.sports || []).filter((sp) => sportNames.includes(sp)).forEach((sp) => {
        const c = ensure(sp, r.standard || "");
        if (r.day === todayName) { c.isToday = true; c.time = r.time || ""; }
      });
    });
    // From authored syllabi → makes the plan visible regardless of the timetable.
    allEntries.forEach((e) => ensure(e.sport, e.standard || "").entries.push(e));

    let combos = Object.values(comboMap).map((c) => ({
      ...c,
      total: c.entries.length,
      done: c.entries.filter((e) => e.status === "completed").length,
      current: c.entries.find((e) => e.status !== "completed") || null,
    }));
    // Keep what's useful: anything with a syllabus, plus today's classes.
    combos = combos.filter((c) => c.total > 0 || c.isToday);
    combos.sort((a, b) => (b.isToday ? 1 : 0) - (a.isToday ? 1 : 0));

    res.json({ success: true, combos, today: combos.filter((c) => c.isToday) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Coach / substitute: mark an entry taught (toggle) ──
router.post("/entries/:id/complete", allowUserOrManager, async (req, res) => {
  try {
    const eff = effectiveTrainer(req);
    if (!eff) return res.status(403).json({ error: "Trainer access required." });
    const entry = await SyllabusEntry.findOne({ _id: req.params.id, clubId: eff.clubId });
    if (!entry) return res.status(404).json({ error: "Entry not found." });
    const completed = req.body.completed !== false;
    entry.status = completed ? "completed" : "planned";
    entry.completedAt = completed ? new Date() : null;
    entry.completedBy = completed ? eff.trainerId : null;
    await entry.save();
    res.json({ success: true, entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
