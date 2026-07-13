const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");
const ExcelJS = require("exceljs");
const { allowUserOrManager } = require("../middleware/authMiddleware");
const { readSheetRows } = require("../utils/excelUtils");
const coaching = require("../src/modules/coaching/coaching.service");
const SchoolClass = require("../src/modules/coaching/models/SchoolClass");

const upload = multer({ dest: "uploads/", limits: { fileSize: 5 * 1024 * 1024 } });

const cleanSections = (raw) =>
  (Array.isArray(raw) ? raw : String(raw || "").split(","))
    .map((s) => String(s).trim())
    .filter(Boolean);

// Map a thrown ServiceError (or anything) to an HTTP response.
const fail = (res, err) => res.status(err.status || 500).json({ error: err.message });

// GET /api/students/template — download a ready-made Excel template.
router.get("/template", allowUserOrManager, async (req, res) => {
  try {
    await coaching.resolveSchoolOrgAdmin(req.user); // auth gate only
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Students");
    ws.columns = [
      { header: "Name", key: "name", width: 30 },
      { header: "Roll No", key: "rollNo", width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.addRow({ name: "Aarav Patil", rollNo: 1 });
    ws.addRow({ name: "Diya Shah", rollNo: 2 });
    ws.addRow({ name: "Kabir Joshi", rollNo: 3 });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Student_Template.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/students/standards — list standards with student counts.
router.get("/standards", allowUserOrManager, async (req, res) => {
  try {
    await coaching.resolveSchoolOrgAdmin(req.user);
    const standards = await coaching.listStandards();
    res.json({ success: true, standards });
  } catch (err) {
    fail(res, err);
  }
});

// ── Class & Section (managed under Student Management) ────────────────
// GET /api/students/classes — list classes + their sections.
router.get("/classes", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await coaching.resolveSchoolOrgAdmin(req.user);
    const classes = await SchoolClass.find({ clubId }).sort({ order: 1, name: 1 }).lean();
    res.json({ success: true, classes });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/students/classes — add a class.
router.post("/classes", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await coaching.resolveSchoolOrgAdmin(req.user);
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Class name is required." });
    const exists = await SchoolClass.findOne({ clubId, name });
    if (exists) return res.status(409).json({ error: "A class with that name already exists." });
    const count = await SchoolClass.countDocuments({ clubId });
    const cls = await SchoolClass.create({
      clubId, name, sections: cleanSections(req.body.sections), order: count,
    });
    res.status(201).json({ success: true, class: cls });
  } catch (err) {
    fail(res, err);
  }
});

// PUT /api/students/classes/:id — rename / set sections.
router.put("/classes/:id", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await coaching.resolveSchoolOrgAdmin(req.user);
    const cls = await SchoolClass.findOne({ _id: req.params.id, clubId });
    if (!cls) return res.status(404).json({ error: "Class not found." });
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: "Class name cannot be empty." });
      const dup = await SchoolClass.findOne({ clubId, name, _id: { $ne: cls._id } });
      if (dup) return res.status(409).json({ error: "A class with that name already exists." });
      cls.name = name;
    }
    if (req.body.sections !== undefined) cls.sections = cleanSections(req.body.sections);
    await cls.save();
    res.json({ success: true, class: cls });
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /api/students/classes/:id — remove a class.
router.delete("/classes/:id", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await coaching.resolveSchoolOrgAdmin(req.user);
    const r = await SchoolClass.deleteOne({ _id: req.params.id, clubId });
    if (r.deletedCount === 0) return res.status(404).json({ error: "Class not found." });
    res.json({ success: true });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/students?standard= — list students (optionally for one standard).
router.get("/", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await coaching.resolveSchoolOrgAdmin(req.user);
    const students = await coaching.listStudents(clubId, { standard: req.query.standard });
    res.json({ success: true, students });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/students — add a single student.
router.post("/", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await coaching.resolveSchoolOrgAdmin(req.user);
    const student = await coaching.createStudent(clubId, req.body);
    res.status(201).json({ success: true, student });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/students/upload — Excel upload for one standard (replaces it).
router.post("/upload", allowUserOrManager, upload.single("file"), async (req, res) => {
  const filePath = req.file && req.file.path;
  try {
    const clubId = await coaching.resolveSchoolOrgAdmin(req.user);
    if (!filePath) return res.status(400).json({ error: "No file uploaded." });
    const rows = await readSheetRows(filePath);
    const result = await coaching.replaceStandardRoster(clubId, req.body.standard, rows);
    res.json({ success: true, ...result });
  } catch (err) {
    fail(res, err);
  } finally {
    if (filePath) fs.unlink(filePath, () => {});
  }
});

// DELETE /api/students/:id — remove one student.
router.delete("/:id", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await coaching.resolveSchoolOrgAdmin(req.user);
    const result = await coaching.deleteStudent(clubId, req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /api/students?standard= — clear a whole standard.
router.delete("/", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await coaching.resolveSchoolOrgAdmin(req.user);
    const result = await coaching.deleteStandard(clubId, req.query.standard);
    res.json({ success: true, ...result });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
