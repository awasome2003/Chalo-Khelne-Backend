/**
 * Event Sponsors Hub controller (Phase 2 — Administration).
 * Agency-scoped sponsor catalog + total secured amount.
 */
const AgencyEvent = require("../src/modules/events/models/AgencyEvent");
const EventSponsor = require("../src/modules/events/models/EventSponsor");
const { resolveAgencyId, getScopedEvent } = require("../src/modules/events/scope");

const FIELDS = ["brand", "partnerType", "tier", "amount", "status", "standeesPosition", "ledRotatingAds"];

const summarize = (items) => {
  const totalSecured = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const paid = items.filter((i) => i.status === "Paid").reduce((s, i) => s + (Number(i.amount) || 0), 0);
  return { count: items.length, totalSecured, paid, pending: totalSecured - paid };
};

exports.list = async (req, res) => {
  try {
    const { agencyId, event } = await getScopedEvent(req, AgencyEvent);
    if (!agencyId) return res.status(403).json({ success: false, message: "No agency context" });
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    const items = await EventSponsor.find({ eventId: event._id }).sort({ createdAt: 1 }).lean();
    return res.json({ success: true, count: items.length, items, summary: summarize(items) });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.create = async (req, res) => {
  try {
    const { agencyId, event } = await getScopedEvent(req, AgencyEvent);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    if (!req.body.brand || !String(req.body.brand).trim()) {
      return res.status(400).json({ success: false, message: "Sponsor brand is required" });
    }
    const payload = { eventId: event._id, agencyId, createdBy: req.user?.id || null };
    for (const k of FIELDS) if (req.body[k] !== undefined) payload[k] = req.body[k];
    const item = await EventSponsor.create(payload);
    const items = await EventSponsor.find({ eventId: event._id }).sort({ createdAt: 1 }).lean();
    return res.status(201).json({ success: true, item, summary: summarize(items) });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.update = async (req, res) => {
  try {
    const agencyId = await resolveAgencyId(req);
    const update = {};
    for (const k of FIELDS) if (req.body[k] !== undefined) update[k] = req.body[k];
    const item = await EventSponsor.findOneAndUpdate(
      { _id: req.params.sponsorId, eventId: req.params.id, agencyId }, update,
      { new: true, runValidators: true }
    );
    if (!item) return res.status(404).json({ success: false, message: "Sponsor not found" });
    const items = await EventSponsor.find({ eventId: req.params.id }).sort({ createdAt: 1 }).lean();
    return res.json({ success: true, item, summary: summarize(items) });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.remove = async (req, res) => {
  try {
    const agencyId = await resolveAgencyId(req);
    const item = await EventSponsor.findOneAndDelete({ _id: req.params.sponsorId, eventId: req.params.id, agencyId });
    if (!item) return res.status(404).json({ success: false, message: "Sponsor not found" });
    const items = await EventSponsor.find({ eventId: req.params.id }).sort({ createdAt: 1 }).lean();
    return res.json({ success: true, message: "Sponsor removed", summary: summarize(items) });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};
