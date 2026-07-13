/**
 * Event Officials Hub controller (Phase 2). Agency-scoped; verifies the event.
 */
const AgencyEvent = require("../src/modules/events/models/AgencyEvent");
const EventOfficial = require("../src/modules/events/models/EventOfficial");
const { resolveAgencyId, getScopedEvent } = require("../src/modules/events/scope");

const FIELDS = ["name", "role", "sport", "court", "shiftStart", "shiftEnd", "payout", "attendance"];

exports.list = async (req, res) => {
  try {
    const { agencyId, event } = await getScopedEvent(req, AgencyEvent);
    if (!agencyId) return res.status(403).json({ success: false, message: "No agency context" });
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    const officials = await EventOfficial.find({ eventId: event._id }).sort({ createdAt: 1 }).lean();
    return res.json({ success: true, count: officials.length, officials });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.create = async (req, res) => {
  try {
    const { agencyId, event } = await getScopedEvent(req, AgencyEvent);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    if (!req.body.name) return res.status(400).json({ success: false, message: "Official name is required" });
    const payload = { eventId: event._id, agencyId, createdBy: req.user?.id || null };
    for (const k of FIELDS) if (req.body[k] !== undefined) payload[k] = req.body[k];
    const official = await EventOfficial.create(payload);
    return res.status(201).json({ success: true, official });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.update = async (req, res) => {
  try {
    const agencyId = await resolveAgencyId(req);
    const update = {};
    for (const k of FIELDS) if (req.body[k] !== undefined) update[k] = req.body[k];
    const official = await EventOfficial.findOneAndUpdate(
      { _id: req.params.officialId, eventId: req.params.id, agencyId }, update,
      { new: true, runValidators: true }
    );
    if (!official) return res.status(404).json({ success: false, message: "Official not found" });
    return res.json({ success: true, official });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.remove = async (req, res) => {
  try {
    const agencyId = await resolveAgencyId(req);
    const official = await EventOfficial.findOneAndDelete({ _id: req.params.officialId, eventId: req.params.id, agencyId });
    if (!official) return res.status(404).json({ success: false, message: "Official not found" });
    return res.json({ success: true, message: "Official removed" });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};
