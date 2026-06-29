const express = require("express");
const router = express.Router();
const path = require("path");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const { allowUserOrManager } = require("../middleware/authMiddleware");
const Substitute = require("../src/modules/identity/models/Substitute");
const ClubAdminProfile = require("../src/modules/org/models/ClubAdminProfile");

// Photo upload — keep the extension so /uploads serves it with the right type.
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) =>
    cb(null, "substitute-" + Date.now() + "-" + Math.round(Math.random() * 1e9) + (path.extname(file.originalname || "") || ".jpg")),
});
const photoUpload = multer({ storage: photoStorage, limits: { fileSize: 8 * 1024 * 1024 } });

// Caller is a trainer/coach (Manager) — proposes a substitute.
function resolveCoach(req, res) {
  if (req.userRole !== "Manager" || !req.user) {
    res.status(403).json({ error: "Trainer/coach access required." });
    return null;
  }
  return req.user;
}

// Caller is a school/organization admin.
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

const phoneDigits = (s) => String(s || "").replace(/\D/g, "") || Math.random().toString(36).slice(-6);

// POST /api/substitutes — coach proposes a substitute (multipart: name, contactNumber, photo)
router.post("/", allowUserOrManager, photoUpload.single("photo"), async (req, res) => {
  try {
    const coach = resolveCoach(req, res);
    if (!coach) return;
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Substitute name is required." });

    // Strictly one substitute per coach — ever. No second request, even after a
    // rejection or after the first substitution has ended.
    const existing = await Substitute.findOne({ coachId: coach._id });
    if (existing) {
      return res.status(400).json({ error: "You can only create one substitute, and you've already created one." });
    }

    const sub = await Substitute.create({
      clubId: coach.clubId,
      coachId: coach._id,
      coachName: coach.name || "",
      name,
      contactNumber: String(req.body.contactNumber || "").trim(),
      photo: req.file ? req.file.filename : "",
      status: "pending",
      active: false,
    });
    res.status(201).json({ success: true, substitute: sub });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/substitutes/mine — coach's latest substitute (status banner / "notification")
router.get("/mine", allowUserOrManager, async (req, res) => {
  try {
    const coach = resolveCoach(req, res);
    if (!coach) return;
    const sub = await Substitute.findOne({ coachId: coach._id }).sort({ createdAt: -1 }).select("-password").lean();
    res.json({ success: true, substitute: sub || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/substitutes — admin list (pending + history)
router.get("/", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await resolveSchoolOrgAdmin(req, res);
    if (!clubId) return;
    const substitutes = await Substitute.find({ clubId }).sort({ createdAt: -1 }).select("-password").lean();
    res.json({ success: true, substitutes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/substitutes/:id — admin detail view (single sub + populated coach)
router.get("/:id", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await resolveSchoolOrgAdmin(req, res);
    if (!clubId) return;
    const sub = await Substitute.findOne({ _id: req.params.id, clubId })
      .populate("coachId", "name email sports staffRole status")
      .select("-password")
      .lean();
    if (!sub) return res.status(404).json({ error: "Substitute not found." });
    res.json({ success: true, substitute: sub });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/substitutes/:id/accept — admin accepts → generate + return credentials
router.post("/:id/accept", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await resolveSchoolOrgAdmin(req, res);
    if (!clubId) return;
    const sub = await Substitute.findOne({ _id: req.params.id, clubId });
    if (!sub) return res.status(404).json({ error: "Substitute not found." });
    if (sub.status === "accepted") return res.status(400).json({ error: "This substitute is already accepted." });

    let email = `sub.${phoneDigits(sub.contactNumber)}@chalokhelne.app`;
    if (await Substitute.findOne({ email, _id: { $ne: sub._id } })) {
      email = `sub.${phoneDigits(sub.contactNumber)}.${Math.random().toString(36).slice(-4)}@chalokhelne.app`;
    }
    const tempPassword = Math.random().toString(36).slice(-8);

    sub.email = email;
    sub.password = await bcrypt.hash(tempPassword, 10);
    sub.status = "accepted";
    sub.active = true;
    sub.rejectionReason = "";
    sub.decidedAt = new Date();
    sub.endedAt = null;
    await sub.save();

    res.json({
      success: true,
      credentials: { email, password: tempPassword },
      substitute: { ...sub.toObject(), password: undefined },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/substitutes/:id/reject — admin rejects
router.post("/:id/reject", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await resolveSchoolOrgAdmin(req, res);
    if (!clubId) return;
    const sub = await Substitute.findOne({ _id: req.params.id, clubId });
    if (!sub) return res.status(404).json({ error: "Substitute not found." });
    sub.status = "rejected";
    sub.active = false;
    sub.rejectionReason = String(req.body.reason || "").trim();
    sub.decidedAt = new Date();
    await sub.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/substitutes/:id/end — coach (own) or admin ends the substitution (coach returned)
router.post("/:id/end", allowUserOrManager, async (req, res) => {
  try {
    const filter = { _id: req.params.id };
    if (req.userRole === "Manager") {
      filter.coachId = req.user._id;
    } else {
      const clubId = await resolveSchoolOrgAdmin(req, res);
      if (!clubId) return;
      filter.clubId = clubId;
    }
    const sub = await Substitute.findOne(filter);
    if (!sub) return res.status(404).json({ error: "Substitute not found." });
    sub.active = false;
    sub.endedAt = new Date();
    await sub.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
