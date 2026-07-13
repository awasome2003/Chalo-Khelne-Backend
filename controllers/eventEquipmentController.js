/**
 * Event Equipment Log controller (Phase 2). Agency-scoped; verifies the event.
 * Can seed inventory from the per-sport equipment templates.
 */
const AgencyEvent = require("../src/modules/events/models/AgencyEvent");
const EventEquipment = require("../src/modules/events/models/EventEquipment");
const { resolveAgencyId, getScopedEvent } = require("../src/modules/events/scope");
const { SPORT_TEMPLATES } = require("../src/modules/events/data/sportTemplates");

const FIELDS = ["name", "sport", "required", "available", "missing", "damaged"];

exports.list = async (req, res) => {
  try {
    const { agencyId, event } = await getScopedEvent(req, AgencyEvent);
    if (!agencyId) return res.status(403).json({ success: false, message: "No agency context" });
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    const items = await EventEquipment.find({ eventId: event._id }).sort({ createdAt: 1 }).lean();
    return res.json({ success: true, count: items.length, items });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.create = async (req, res) => {
  try {
    const { agencyId, event } = await getScopedEvent(req, AgencyEvent);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    if (!req.body.name) return res.status(400).json({ success: false, message: "Asset name is required" });
    const payload = { eventId: event._id, agencyId, createdBy: req.user?.id || null };
    for (const k of FIELDS) if (req.body[k] !== undefined) payload[k] = req.body[k];
    const item = await EventEquipment.create(payload);
    return res.status(201).json({ success: true, item });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.update = async (req, res) => {
  try {
    const agencyId = await resolveAgencyId(req);
    const update = {};
    for (const k of FIELDS) if (req.body[k] !== undefined) update[k] = req.body[k];
    const item = await EventEquipment.findOneAndUpdate(
      { _id: req.params.itemId, eventId: req.params.id, agencyId }, update,
      { new: true, runValidators: true }
    );
    if (!item) return res.status(404).json({ success: false, message: "Asset not found" });
    return res.json({ success: true, item });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.remove = async (req, res) => {
  try {
    const agencyId = await resolveAgencyId(req);
    const item = await EventEquipment.findOneAndDelete({ _id: req.params.itemId, eventId: req.params.id, agencyId });
    if (!item) return res.status(404).json({ success: false, message: "Asset not found" });
    return res.json({ success: true, message: "Asset removed" });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

// Seed inventory from the event's sport equipment templates (adds missing items by name).
exports.seed = async (req, res) => {
  try {
    const { agencyId, event } = await getScopedEvent(req, AgencyEvent);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });

    const sports = (event.sports && event.sports.length) ? event.sports : [];
    const wanted = []; // { name, required, sport }
    for (const sport of sports) {
      const tpl = SPORT_TEMPLATES[sport];
      if (tpl) tpl.equipment.forEach((e) => wanted.push({ name: e.name, required: e.required, sport }));
    }

    const existing = new Set((await EventEquipment.find({ eventId: event._id }).select("name").lean()).map((i) => i.name));
    const toCreate = wanted
      .filter((w) => !existing.has(w.name))
      .map((w) => ({ eventId: event._id, agencyId, name: w.name, sport: w.sport, required: w.required, available: 0, missing: 0, damaged: 0, createdBy: req.user?.id || null }));

    if (toCreate.length) await EventEquipment.insertMany(toCreate);
    const items = await EventEquipment.find({ eventId: event._id }).sort({ createdAt: 1 }).lean();
    return res.json({ success: true, added: toCreate.length, count: items.length, items });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};
