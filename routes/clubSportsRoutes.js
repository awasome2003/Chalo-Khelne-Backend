const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { allowUserOrManager } = require("../middleware/authMiddleware");
const ClubSport = require("../src/modules/org/models/ClubSport");
const ClubAdminProfile = require("../src/modules/org/models/ClubAdminProfile");
const Manager = require("../src/modules/identity/models/ClubManager").Manager;
const { effectiveTrainer } = require("../utils/trainerScope");

// Resolve the owning club (ClubAdmin / corporate_admin) and confirm it's a
// school / organization — only those manage sports & trainer assignments.
async function resolveSchoolOrg(req, res) {
  const u = req.user;
  if (!u || (u.role !== "ClubAdmin" && u.role !== "corporate_admin")) {
    res.status(403).json({ error: "Only a school or organization admin can manage sports." });
    return null;
  }
  const clubId = String(u._id);
  const profile = await ClubAdminProfile.findOne({ userId: clubId }).select("orgType").lean();
  const orgType = profile?.orgType || "club";
  if (orgType !== "school" && orgType !== "organization") {
    res.status(403).json({ error: "Only school or organization admins can manage sports." });
    return null;
  }
  return clubId;
}

// Snapshot a slot's display name from the trainer (or "Not decided").
async function buildSlots(rawTrainers, clubId) {
  const slots = Array.isArray(rawTrainers) ? rawTrainers : [];
  const out = [];
  for (const s of slots) {
    const trainerId = s && s.trainer ? String(s.trainer) : null;
    if (trainerId && mongoose.Types.ObjectId.isValid(trainerId)) {
      // Only accept trainers that belong to this club and are trainers.
      const m = await Manager.findOne({ _id: trainerId, clubId, staffRole: "trainer" }).select("name").lean();
      if (m) {
        out.push({ trainer: m._id, name: m.name });
        continue;
      }
    }
    out.push({ trainer: null, name: "Not decided" });
  }
  return out;
}

// GET /api/club-sports — list this club's sports with assigned trainers.
router.get("/", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await resolveSchoolOrg(req, res);
    if (!clubId) return;
    const sports = await ClubSport.find({ clubId }).sort({ name: 1 }).lean();
    res.json({ success: true, sports });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/club-sports/mine — sports the logged-in trainer (Manager) is
// assigned to. Used by the trainer mobile app.
router.get("/mine", allowUserOrManager, async (req, res) => {
  try {
    const eff = effectiveTrainer(req); // substitute → the coach
    if (!eff || !eff.trainerId) return res.json({ success: true, sports: [] });
    const sports = await ClubSport.find({
      clubId: eff.clubId || undefined,
      "trainers.trainer": eff.trainerId,
    })
      .sort({ name: 1 })
      .lean();
    res.json({ success: true, sports });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/club-sports — add an available sport.
router.post("/", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await resolveSchoolOrg(req, res);
    if (!clubId) return;
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Sport name is required." });

    const exists = await ClubSport.findOne({ clubId, name });
    if (exists) return res.status(400).json({ error: "This sport is already added." });

    const sport = await ClubSport.create({ clubId, name, trainers: [] });
    res.status(201).json({ success: true, sport });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/club-sports/:id/trainers — set the trainer slots for a sport.
router.put("/:id/trainers", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await resolveSchoolOrg(req, res);
    if (!clubId) return;
    const sport = await ClubSport.findOne({ _id: req.params.id, clubId });
    if (!sport) return res.status(404).json({ error: "Sport not found." });

    sport.trainers = await buildSlots(req.body.trainers, clubId);
    await sport.save();
    res.json({ success: true, sport });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/club-sports/:id — remove an available sport.
router.delete("/:id", allowUserOrManager, async (req, res) => {
  try {
    const clubId = await resolveSchoolOrg(req, res);
    if (!clubId) return;
    const r = await ClubSport.deleteOne({ _id: req.params.id, clubId });
    if (r.deletedCount === 0) return res.status(404).json({ error: "Sport not found." });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
