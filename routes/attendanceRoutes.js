const express = require("express");
const router = express.Router();
const { allowUserOrManager } = require("../middleware/authMiddleware");
const { effectiveTrainer } = require("../utils/trainerScope");
const coaching = require("../src/modules/coaching/coaching.service");

const fail = (res, err) => res.status(err.status || 500).json({ error: err.message });

// GET /api/attendance/admin?trainerId=&date=&standard=
router.get("/admin", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await coaching.resolveSchoolOrgAdmin(req.user);
    const sessions = await coaching.getAdminAttendance(clubId, req.query);
    res.json({ success: true, sessions });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/attendance/history — the logged-in trainer's own past sessions.
router.get("/history", allowUserOrManager, async (req, res) => {
  try {
    const sessions = await coaching.getTrainerHistory(effectiveTrainer(req));
    res.json({ success: true, sessions });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/attendance/students?standard= — school roster for a standard.
router.get("/students", allowUserOrManager, async (req, res) => {
  try {
    const students = await coaching.getStudentsForTrainer(effectiveTrainer(req), req.query.standard);
    res.json({ success: true, students });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/attendance?date=&sport=&standard=
router.get("/", allowUserOrManager, async (req, res) => {
  try {
    const result = await coaching.getAttendanceSession(effectiveTrainer(req), req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/attendance  { date, sport, standard, self, selfReason, students:[{studentId,status}] }
router.post("/", allowUserOrManager, async (req, res) => {
  try {
    const result = await coaching.markAttendance(effectiveTrainer(req), req.body);
    res.json({ success: true, ...result });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
