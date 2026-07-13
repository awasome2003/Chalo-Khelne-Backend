/**
 * Event Staff Hub controller (Phase 2). Agency-scoped; verifies the event.
 */
const AgencyEvent = require("../src/modules/events/models/AgencyEvent");
const EventStaff = require("../src/modules/events/models/EventStaff");
const { resolveAgencyId, getScopedEvent } = require("../src/modules/events/scope");

const FIELDS = ["name", "role", "shiftStart", "shiftEnd", "reportingManager", "status", "attendance"];

exports.list = async (req, res) => {
  try {
    const { agencyId, event } = await getScopedEvent(req, AgencyEvent);
    if (!agencyId) return res.status(403).json({ success: false, message: "No agency context" });
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    const staff = await EventStaff.find({ eventId: event._id }).sort({ createdAt: 1 }).lean();
    return res.json({ success: true, count: staff.length, staff });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.create = async (req, res) => {
  try {
    const { agencyId, event } = await getScopedEvent(req, AgencyEvent);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    if (!req.body.name) return res.status(400).json({ success: false, message: "Staff name is required" });
    const payload = { eventId: event._id, agencyId, createdBy: req.user?.id || null };
    for (const k of FIELDS) if (req.body[k] !== undefined) payload[k] = req.body[k];
    const member = await EventStaff.create(payload);
    return res.status(201).json({ success: true, staff: member });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.update = async (req, res) => {
  try {
    const agencyId = await resolveAgencyId(req);
    const update = {};
    for (const k of FIELDS) if (req.body[k] !== undefined) update[k] = req.body[k];
    const member = await EventStaff.findOneAndUpdate(
      { _id: req.params.staffId, eventId: req.params.id, agencyId }, update,
      { new: true, runValidators: true }
    );
    if (!member) return res.status(404).json({ success: false, message: "Staff not found" });
    return res.json({ success: true, staff: member });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.remove = async (req, res) => {
  try {
    const agencyId = await resolveAgencyId(req);
    const member = await EventStaff.findOneAndDelete({ _id: req.params.staffId, eventId: req.params.id, agencyId });
    if (!member) return res.status(404).json({ success: false, message: "Staff not found" });
    return res.json({ success: true, message: "Staff removed" });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};
