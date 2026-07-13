/**
 * AgencyEvent controller — Event OS core CRUD (Phase 0).
 * All operations are scoped to the caller's agency (agencyId) and guarded by
 * event:* permissions at the route layer.
 */
const AgencyEvent = require("../src/modules/events/models/AgencyEvent");
const EventTask = require("../src/modules/events/models/EventTask");
const User = require("../src/modules/identity/models/User");
const { createTournamentForEvent } = require("../src/modules/events/eventTournamentBridge");

// Resolve the caller's agency: agency admins own their own id; staff carry
// an agencyId pointing to their admin. Falls back to the caller's own id.
async function resolveAgencyId(req) {
  const uid = req.user?.id || req.user?._id || req.user?.userId;
  if (!uid) return null;
  const user = await User.findById(uid).select("agencyId role").lean();
  if (!user) return null;
  return user.agencyId || user._id;
}

exports.createEvent = async (req, res) => {
  try {
    const agencyId = await resolveAgencyId(req);
    if (!agencyId) return res.status(403).json({ success: false, message: "No agency context" });
    if (!req.body.name) return res.status(400).json({ success: false, message: "Event name is required" });

    const allowed = [
      "name", "type", "sports", "venue", "clientId", "clientType", "date", "time",
      "organizer", "expectedParticipants", "registrationType", "registrationFee",
      "status", "timeline", "linkedTournamentId",
    ];
    const payload = { agencyId, createdBy: req.user?.id || null };
    for (const k of allowed) if (req.body[k] !== undefined) payload[k] = req.body[k];

    // "Create Event = Create Tournament": if the event has sports, spin up a
    // linked Tournament (the scoring engine) so it gets fixtures + live scoring.
    let tournamentWarning = null;
    if (Array.isArray(payload.sports) && payload.sports.length) {
      try {
        const agency = await User.findById(agencyId).select("clubName name").lean();
        const t = await createTournamentForEvent(payload, agencyId, agency?.clubName || agency?.name);
        if (t) payload.linkedTournamentId = t._id;
      } catch (e) {
        tournamentWarning = `Event saved, but linked tournament could not be created: ${e.message}`;
      }
    }

    const event = await AgencyEvent.create(payload);
    return res.status(201).json({ success: true, event, tournamentWarning });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Affiliated accounts — clubs/schools/corporates the agency onboarded
// (User.agencyId === this agency). Optional ?type=school|corporate|club|organization.
exports.affiliatedAccounts = async (req, res) => {
  try {
    const agencyId = await resolveAgencyId(req);
    if (!agencyId) return res.status(403).json({ success: false, message: "No agency context" });

    const accounts = await User.find({ agencyId, _id: { $ne: agencyId } })
      .select("name email clubName role createdAt").sort({ createdAt: -1 }).lean();

    const ClubAdmin = require("../src/modules/org/models/ClubAdminProfile");
    const profs = await ClubAdmin.find({ userId: { $in: accounts.map((a) => a._id) } }).select("userId orgType city area").lean();
    const byId = {};
    profs.forEach((p) => { byId[String(p.userId)] = p; });

    let rows = accounts.map((a) => {
      const p = byId[String(a._id)] || {};
      return { id: a._id, name: a.name, clubName: a.clubName || "—", email: a.email, role: a.role, orgType: p.orgType || null, city: p.city || "" };
    });
    const type = (req.query.type || "").toLowerCase();
    if (type) rows = rows.filter((r) => (r.orgType || "").toLowerCase() === type);

    return res.json({ success: true, count: rows.length, accounts: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.dashboardSummary = async (req, res) => {
  try {
    const agencyId = await resolveAgencyId(req);
    if (!agencyId) return res.status(403).json({ success: false, message: "No agency context" });

    const events = await AgencyEvent.find({ agencyId }).sort({ createdAt: -1 }).lean();
    const by = (s) => events.filter((e) => e.status === s).length;
    const eventIds = events.map((e) => e._id);
    const pendingTasks = eventIds.length
      ? await EventTask.countDocuments({ eventId: { $in: eventIds }, status: { $ne: "Completed" } })
      : 0;

    return res.json({
      success: true,
      stats: {
        totalEvents: events.length,
        live: by("Live"),
        upcoming: by("Planned") + by("Draft"),
        completed: by("Completed"),
        pendingTasks,
      },
      recentEvents: events.slice(0, 6),
    });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

// Wrap a just-created Tournament (via the manager wizard) in an AgencyEvent.
// Idempotent: if an event already links this tournament, return it.
exports.createEventFromTournament = async (req, res) => {
  try {
    const agencyId = await resolveAgencyId(req);
    if (!agencyId) return res.status(403).json({ success: false, message: "No agency context" });
    const { tournamentId } = req.body;
    if (!tournamentId) return res.status(400).json({ success: false, message: "tournamentId is required" });

    const Tournament = require("../src/modules/tournaments/models/Tournament");
    const t = await Tournament.findById(tournamentId).lean();
    if (!t) return res.status(404).json({ success: false, message: "Tournament not found" });

    // Ownership: the tournament must belong to this agency (managerId or clubId).
    const owns = (t.managerId || []).some((m) => String(m) === String(agencyId)) || String(t.clubId) === String(agencyId);
    if (!owns) return res.status(403).json({ success: false, message: "Tournament does not belong to this agency" });

    const existing = await AgencyEvent.findOne({ agencyId, linkedTournamentId: t._id });
    if (existing) return res.status(200).json({ success: true, event: existing, existed: true });

    const cat0 = t.sports?.[0]?.categories?.[0];
    const event = await AgencyEvent.create({
      agencyId, createdBy: req.user?.id || null,
      name: t.title,
      type: "Tournament",
      sports: (t.sports || []).map((s) => s.sportName).filter(Boolean),
      venue: (t.eventLocation && t.eventLocation[0]) || "",
      date: t.startDate || "",
      time: t.selectedTime?.startTime || "",
      organizer: t.organizerName || "",
      registrationType: cat0 && cat0.fee ? "Paid" : "Free",
      registrationFee: cat0 ? cat0.fee : null,
      status: "Planned",
      linkedTournamentId: t._id,
    });
    return res.status(201).json({ success: true, event });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Teams & Players directory — registrations synced from the event's linked
// tournament, mapped to a flat roster.
exports.eventDirectory = async (req, res) => {
  try {
    const agencyId = await resolveAgencyId(req);
    if (!agencyId) return res.status(403).json({ success: false, message: "No agency context" });
    const event = await AgencyEvent.findOne({ _id: req.params.id, agencyId }).lean();
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    const emptyStats = { registrations: 0, affiliatedAccounts: 0, projectedRevenue: 0 };
    if (!event.linkedTournamentId) return res.json({ success: true, rows: [], stats: emptyStats });

    const Booking = require("../src/modules/tournaments/models/BookingModel");
    const bookings = await Booking.find({ tournamentId: event.linkedTournamentId })
      .populate("userId", "clubName name")
      .sort({ createdAt: 1 })
      .lean();

    const statusMap = { confirmed: "Approved", pending: "Pending", cancelled: "Cancelled" };
    const rows = bookings.map((b) => ({
      name: b.team?.name || b.userName || "—",
      category: b.team?.name ? "Team" : "Individual",
      entity: b.userId?.clubName || b.team?.name || "Independent",
      contact: b.userEmail || b.userPhone || "—",
      status: statusMap[b.status] || "Pending",
    }));
    const entities = new Set(rows.map((r) => r.entity).filter((e) => e && e !== "Independent"));
    const stats = {
      registrations: rows.length,
      affiliatedAccounts: entities.size,
      projectedRevenue: bookings.reduce((s, b) => s + (b.paymentAmount || 0), 0),
    };
    return res.json({ success: true, count: rows.length, rows, stats });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.listEvents = async (req, res) => {
  try {
    const agencyId = await resolveAgencyId(req);
    if (!agencyId) return res.status(403).json({ success: false, message: "No agency context" });

    const q = { agencyId };
    if (req.query.status) q.status = req.query.status;
    if (req.query.type) q.type = req.query.type;

    const events = await AgencyEvent.find(q).sort({ createdAt: -1 }).lean();
    return res.json({ success: true, count: events.length, events });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.getEvent = async (req, res) => {
  try {
    const agencyId = await resolveAgencyId(req);
    const event = await AgencyEvent.findOne({ _id: req.params.id, agencyId }).lean();
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    return res.json({ success: true, event });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateEvent = async (req, res) => {
  try {
    const agencyId = await resolveAgencyId(req);
    const allowed = [
      "name", "type", "sports", "venue", "clientId", "clientType", "date", "time",
      "organizer", "expectedParticipants", "registrationType", "registrationFee",
      "status", "timeline", "linkedTournamentId",
    ];
    const update = {};
    for (const k of allowed) if (req.body[k] !== undefined) update[k] = req.body[k];

    const event = await AgencyEvent.findOneAndUpdate(
      { _id: req.params.id, agencyId }, update, { new: true, runValidators: true }
    );
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    return res.json({ success: true, event });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.deleteEvent = async (req, res) => {
  try {
    const agencyId = await resolveAgencyId(req);
    const event = await AgencyEvent.findOneAndDelete({ _id: req.params.id, agencyId });
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    return res.json({ success: true, message: "Event deleted" });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
