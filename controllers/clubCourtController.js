/**
 * Club Courts controller (Club OS — facility-business).
 * Tenant-scoped by clubId (= club_admin User._id).
 */
const ClubCourt = require("../src/modules/club/models/ClubCourt");
const { resolveClubId } = require("../src/modules/club/scope");

const FIELDS = ["name", "sport", "surfaceType", "isIndoor", "capacity", "pricePerHour", "peakHourPrice", "status", "operatingHours", "maintenanceReason", "isActive"];

exports.list = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    const courts = await ClubCourt.find({ clubId }).sort({ createdAt: 1 }).lean();
    const stats = {
      total: courts.length,
      available: courts.filter((c) => c.status === "Available").length,
      occupied: courts.filter((c) => c.status === "Occupied").length,
      maintenance: courts.filter((c) => c.status === "Maintenance").length,
    };
    return res.json({ success: true, count: courts.length, courts, stats });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.create = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    if (!req.body.name || !String(req.body.name).trim()) return res.status(400).json({ success: false, message: "Court name is required" });
    if (!req.body.sport || !String(req.body.sport).trim()) return res.status(400).json({ success: false, message: "Sport is required" });
    const payload = { clubId, createdBy: req.user?.id || null };
    for (const k of FIELDS) if (req.body[k] !== undefined) payload[k] = req.body[k];
    const court = await ClubCourt.create(payload);
    return res.status(201).json({ success: true, court });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.update = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const update = {};
    for (const k of FIELDS) if (req.body[k] !== undefined) update[k] = req.body[k];
    const court = await ClubCourt.findOneAndUpdate({ _id: req.params.courtId, clubId }, update, { new: true, runValidators: true });
    if (!court) return res.status(404).json({ success: false, message: "Court not found" });
    return res.json({ success: true, court });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

// Dedicated status transition (Available / Occupied / Maintenance).
exports.updateStatus = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const { status, maintenanceReason } = req.body;
    if (!["Available", "Occupied", "Maintenance"].includes(status)) {
      return res.status(400).json({ success: false, message: "status must be Available, Occupied or Maintenance" });
    }
    const update = { status, maintenanceReason: status === "Maintenance" ? (maintenanceReason || "") : "" };
    const court = await ClubCourt.findOneAndUpdate({ _id: req.params.courtId, clubId }, update, { new: true });
    if (!court) return res.status(404).json({ success: false, message: "Court not found" });
    return res.json({ success: true, court });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.remove = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const court = await ClubCourt.findOneAndDelete({ _id: req.params.courtId, clubId });
    if (!court) return res.status(404).json({ success: false, message: "Court not found" });
    return res.json({ success: true, message: "Court removed" });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};
