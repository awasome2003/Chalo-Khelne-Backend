/**
 * Event Venue Manager controller (Phase 2). Agency-scoped; verifies the event.
 * Can seed stations from the linked tournament's courts.
 */
const AgencyEvent = require("../src/modules/events/models/AgencyEvent");
const EventVenue = require("../src/modules/events/models/EventVenue");
const { resolveAgencyId, getScopedEvent } = require("../src/modules/events/scope");

const FIELDS = ["name", "sport", "status", "currentMatch", "liveStream"];

exports.list = async (req, res) => {
  try {
    const { agencyId, event } = await getScopedEvent(req, AgencyEvent);
    if (!agencyId) return res.status(403).json({ success: false, message: "No agency context" });
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    const venues = await EventVenue.find({ eventId: event._id }).sort({ createdAt: 1 }).lean();
    return res.json({ success: true, count: venues.length, venues });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.create = async (req, res) => {
  try {
    const { agencyId, event } = await getScopedEvent(req, AgencyEvent);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    if (!req.body.name) return res.status(400).json({ success: false, message: "Station name is required" });
    const payload = { eventId: event._id, agencyId, createdBy: req.user?.id || null };
    for (const k of FIELDS) if (req.body[k] !== undefined) payload[k] = req.body[k];
    const venue = await EventVenue.create(payload);
    return res.status(201).json({ success: true, venue });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.update = async (req, res) => {
  try {
    const agencyId = await resolveAgencyId(req);
    const update = {};
    for (const k of FIELDS) if (req.body[k] !== undefined) update[k] = req.body[k];
    const venue = await EventVenue.findOneAndUpdate(
      { _id: req.params.venueId, eventId: req.params.id, agencyId }, update,
      { new: true, runValidators: true }
    );
    if (!venue) return res.status(404).json({ success: false, message: "Station not found" });
    return res.json({ success: true, venue });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.remove = async (req, res) => {
  try {
    const agencyId = await resolveAgencyId(req);
    const venue = await EventVenue.findOneAndDelete({ _id: req.params.venueId, eventId: req.params.id, agencyId });
    if (!venue) return res.status(404).json({ success: false, message: "Station not found" });
    return res.json({ success: true, message: "Station removed" });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

// Seed stations from the linked tournament's courts (adds missing ones by name).
exports.seed = async (req, res) => {
  try {
    const { agencyId, event } = await getScopedEvent(req, AgencyEvent);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    if (!event.linkedTournamentId) return res.status(400).json({ success: false, message: "No linked tournament to seed courts from" });

    const Tournament = require("../src/modules/tournaments/models/Tournament");
    const t = await Tournament.findById(event.linkedTournamentId).select("courts sports").lean();
    const courts = (t?.courts || []).filter((c) => c.isActive !== false);
    const sportById = {};
    (t?.sports || []).forEach((s) => { if (s.sportId) sportById[String(s.sportId)] = s.sportName; });

    const existing = new Set((await EventVenue.find({ eventId: event._id }).select("name").lean()).map((v) => v.name));
    const toCreate = courts
      .filter((c) => c.name && !existing.has(c.name))
      .map((c) => ({ eventId: event._id, agencyId, name: c.name, sport: sportById[String(c.sportId)] || (event.sports?.[0] || ""), status: "Available", createdBy: req.user?.id || null }));

    if (toCreate.length) await EventVenue.insertMany(toCreate);
    const venues = await EventVenue.find({ eventId: event._id }).sort({ createdAt: 1 }).lean();
    return res.json({ success: true, added: toCreate.length, count: venues.length, venues });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};
