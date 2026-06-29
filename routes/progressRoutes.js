const express = require("express");
const router = express.Router();
const { allowUserOrManager } = require("../middleware/authMiddleware");
const StudentProgress = require("../src/modules/coaching/models/StudentProgress");
const ProgressSubmission = require("../src/modules/coaching/models/ProgressSubmission");
const ProgressHistory = require("../src/modules/coaching/models/ProgressHistory");
const SyllabusEntry = require("../src/modules/coaching/models/SyllabusEntry");
const Student = require("../src/modules/coaching/models/Student");
const ClubSport = require("../src/modules/org/models/ClubSport");
const ClubAdminProfile = require("../src/modules/org/models/ClubAdminProfile");
const { effectiveTrainer } = require("../utils/trainerScope");
const coaching = require("../src/modules/coaching/coaching.service");

// Resolve who is acting and what sports they may touch.
//  - Coach/Substitute  → clubId + trainerId, allowedSports = their assigned sports.
//  - School/Org admin   → clubId, allowedSports = null (all sports).
// Returns { clubId, trainerId, isCoach, allowedSports } or null (and sends 403).
async function resolveActor(req, res) {
  const eff = effectiveTrainer(req);
  if (eff && eff.trainerId) {
    const sports = await ClubSport.find({ clubId: eff.clubId, "trainers.trainer": eff.trainerId })
      .select("name").lean();
    return { clubId: String(eff.clubId), trainerId: eff.trainerId, isCoach: true, allowedSports: sports.map((s) => s.name) };
  }
  const u = req.user;
  if (u && (u.role === "ClubAdmin" || u.role === "corporate_admin")) {
    const profile = await ClubAdminProfile.findOne({ userId: String(u._id) }).select("orgType").lean();
    const orgType = profile?.orgType || "club";
    if (orgType === "school" || orgType === "organization") {
      return { clubId: String(u._id), trainerId: null, isCoach: false, allowedSports: null };
    }
  }
  res.status(403).json({ error: "Trainer or school/organization admin access required." });
  return null;
}

const mayUseSport = (actor, sport) => !actor.isCoach || (actor.allowedSports || []).includes(sport);

const avg = (nums) => (nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : 0);

// ── Marking grid: students × topics + existing ratings for a (sport, standard) ──
router.get("/matrix", allowUserOrManager, async (req, res) => {
  try {
    const actor = await resolveActor(req, res);
    if (!actor) return;
    const sport = String(req.query.sport || "").trim();
    const standard = String(req.query.standard || "").trim();
    if (!sport || !standard) return res.status(400).json({ error: "sport and standard are required." });
    if (!mayUseSport(actor, sport)) return res.status(403).json({ error: "You are not assigned to this sport." });

    const [topics, students, ratings] = await Promise.all([
      SyllabusEntry.find({ clubId: actor.clubId, sport, standard }).sort({ weekNumber: 1, order: 1 })
        .select("weekNumber topic objectives activities equipment").lean(),
      Student.find({ clubId: actor.clubId, standard }).sort({ order: 1, name: 1 }).select("name rollNo").lean(),
      StudentProgress.find({ clubId: actor.clubId, sport, standard }).select("studentId syllabusEntryId stars remark").lean(),
    ]);
    const map = {};
    ratings.forEach((r) => { map[`${r.studentId}|${r.syllabusEntryId}`] = { stars: r.stars, remark: r.remark || "" }; });
    res.json({ success: true, sport, standard, topics, students, ratings: map, canEdit: actor.isCoach || true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Upsert one rating (stars 1–5, or 0 to clear) ──
router.post("/rate", allowUserOrManager, async (req, res) => {
  try {
    const actor = await resolveActor(req, res);
    if (!actor) return;
    const { studentId, syllabusEntryId } = req.body;
    const stars = Number(req.body.stars);
    const remark = String(req.body.remark || "").trim();
    if (!studentId || !syllabusEntryId) return res.status(400).json({ error: "studentId and syllabusEntryId are required." });

    const entry = await SyllabusEntry.findOne({ _id: syllabusEntryId, clubId: actor.clubId }).select("sport standard").lean();
    if (!entry) return res.status(404).json({ error: "Syllabus topic not found." });
    if (!mayUseSport(actor, entry.sport)) return res.status(403).json({ error: "You are not assigned to this sport." });
    const student = await Student.findOne({ _id: studentId, clubId: actor.clubId, standard: entry.standard }).select("_id").lean();
    if (!student) return res.status(404).json({ error: "Student not found for this standard." });

    if (!stars || stars < 1) {
      await StudentProgress.deleteOne({ clubId: actor.clubId, studentId, syllabusEntryId });
      return res.json({ success: true, cleared: true });
    }
    if (stars > 5) return res.status(400).json({ error: "Stars must be 1–5." });

    const doc = await StudentProgress.findOneAndUpdate(
      { clubId: actor.clubId, studentId, syllabusEntryId },
      { $set: { stars, remark, sport: entry.sport, standard: entry.standard, ratedBy: actor.trainerId } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, rating: { stars: doc.stars, remark: doc.remark } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Student list for a (sport, standard) with each one's average + progress ──
router.get("/students", allowUserOrManager, async (req, res) => {
  try {
    const actor = await resolveActor(req, res);
    if (!actor) return;
    const sport = String(req.query.sport || "").trim();
    const standard = String(req.query.standard || "").trim();
    if (!sport || !standard) return res.status(400).json({ error: "sport and standard are required." });
    if (!mayUseSport(actor, sport)) return res.status(403).json({ error: "You are not assigned to this sport." });

    const [students, totalTopics, ratings] = await Promise.all([
      Student.find({ clubId: actor.clubId, standard }).sort({ order: 1, name: 1 }).select("name rollNo").lean(),
      SyllabusEntry.countDocuments({ clubId: actor.clubId, sport, standard }),
      StudentProgress.find({ clubId: actor.clubId, sport, standard }).select("studentId stars").lean(),
    ]);
    const byStudent = {};
    ratings.forEach((r) => { (byStudent[r.studentId] = byStudent[r.studentId] || []).push(r.stars); });
    res.json({
      success: true, sport, standard, totalTopics,
      students: students.map((s) => {
        const arr = byStudent[s._id] || [];
        return { ...s, average: avg(arr), rated: arr.length, totalTopics };
      }),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Per-student report (all sports for admin; the coach's sport if ?sport=) ──
// Phase 3: migrated to the coaching service (controller now parses → calls → responds).
router.get("/student/:studentId", allowUserOrManager, async (req, res) => {
  try {
    const actor = await coaching.resolveProgressActor({ user: req.user, eff: effectiveTrainer(req) });
    const report = await coaching.getStudentProgressReport(actor, req.params.studentId, { sport: req.query.sport });
    res.json({ success: true, ...report });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── Coach: submit (freeze) the current ratings for a class as a session report ──
router.post("/submit", allowUserOrManager, async (req, res) => {
  try {
    const actor = await resolveActor(req, res);
    if (!actor) return;
    const sport = String(req.body.sport || "").trim();
    const standard = String(req.body.standard || "").trim();
    const sessionDate = String(req.body.sessionDate || "").trim();
    if (!sport || !standard) return res.status(400).json({ error: "sport and standard are required." });
    if (!mayUseSport(actor, sport)) return res.status(403).json({ error: "You are not assigned to this sport." });

    const current = await StudentProgress.find({ clubId: actor.clubId, sport, standard }).lean();
    if (!current.length) return res.status(400).json({ error: "Nothing to submit — rate students first." });

    const [students, entries] = await Promise.all([
      Student.find({ clubId: actor.clubId, standard }).select("name rollNo").lean(),
      SyllabusEntry.find({ clubId: actor.clubId, sport, standard }).select("weekNumber topic").lean(),
    ]);
    const sMap = {}; students.forEach((s) => { sMap[String(s._id)] = s; });
    const eMap = {}; entries.forEach((e) => { eMap[String(e._id)] = e; });

    const submittedAt = new Date();
    const submittedByName = req.user?.coachName || req.user?.name || "";
    const studentIds = new Set();
    const allStars = [];
    const rows = current.map((c) => {
      const st = sMap[String(c.studentId)] || {};
      const en = eMap[String(c.syllabusEntryId)] || {};
      studentIds.add(String(c.studentId));
      allStars.push(c.stars);
      return {
        clubId: actor.clubId, sport, standard,
        studentId: c.studentId, studentName: st.name || "", rollNo: st.rollNo || "",
        syllabusEntryId: c.syllabusEntryId, weekNumber: en.weekNumber || 0, topic: en.topic || "",
        stars: c.stars, remark: c.remark || "", submittedAt,
      };
    });

    const submission = await ProgressSubmission.create({
      clubId: actor.clubId, sport, standard,
      submittedBy: actor.trainerId, submittedByName, sessionDate,
      studentsCount: studentIds.size, topicsCount: new Set(current.map((c) => String(c.syllabusEntryId))).size,
      average: avg(allStars),
    });
    await ProgressHistory.insertMany(rows.map((r) => ({ ...r, submissionId: submission._id })));

    res.json({ success: true, submission: { _id: submission._id, studentsCount: submission.studentsCount, average: submission.average } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── List frozen session reports for a (sport, standard) ──
router.get("/history", allowUserOrManager, async (req, res) => {
  try {
    const actor = await resolveActor(req, res);
    if (!actor) return;
    const sport = String(req.query.sport || "").trim();
    const standard = String(req.query.standard || "").trim();
    if (!sport || !standard) return res.status(400).json({ error: "sport and standard are required." });
    if (!mayUseSport(actor, sport)) return res.status(403).json({ error: "You are not assigned to this sport." });
    const submissions = await ProgressSubmission.find({ clubId: actor.clubId, sport, standard })
      .sort({ createdAt: -1 }).lean();
    res.json({ success: true, submissions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── One frozen session report (read-only snapshot, grouped by student) ──
router.get("/history/submission/:id", allowUserOrManager, async (req, res) => {
  try {
    const actor = await resolveActor(req, res);
    if (!actor) return;
    const submission = await ProgressSubmission.findOne({ _id: req.params.id, clubId: actor.clubId }).lean();
    if (!submission) return res.status(404).json({ error: "Report not found." });
    if (!mayUseSport(actor, submission.sport)) return res.status(403).json({ error: "Not allowed." });
    const rows = await ProgressHistory.find({ clubId: actor.clubId, submissionId: submission._id })
      .sort({ rollNo: 1, studentName: 1, weekNumber: 1 }).lean();
    const byStudent = {};
    rows.forEach((r) => {
      const k = String(r.studentId);
      (byStudent[k] = byStudent[k] || { studentId: r.studentId, name: r.studentName, rollNo: r.rollNo, topics: [] })
        .topics.push({ weekNumber: r.weekNumber, topic: r.topic, stars: r.stars, remark: r.remark });
    });
    const students = Object.values(byStudent).map((s) => ({
      ...s, average: avg(s.topics.map((t) => t.stars)),
    }));
    res.json({ success: true, submission, students });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
