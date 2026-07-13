/**
 * Event Registrations controller (Phase 2 — Logistics).
 *
 * The "Registration Desk & QR Pass Verification" screen is the agency-side view
 * of the SAME tournament bookings the manager approves via
 * BookingController.updateBookingStatus. We reuse that exact status transition
 * (accepted → confirmed+paid, rejected → cancelled) and player notification,
 * but expose it agency-scoped (unifiedAuth + event:manage) because managerAuth
 * loads a Manager doc and an Agency Admin is a User.
 */
const AgencyEvent = require("../src/modules/events/models/AgencyEvent");
const { resolveAgencyId, getScopedEvent } = require("../src/modules/events/scope");
const Booking = require("../src/modules/tournaments/models/BookingModel");

const STATUS_LABEL = { confirmed: "Approved", pending: "Pending", cancelled: "Rejected" };

const toRow = (b) => ({
  bookingId: String(b._id),
  userId: b.userId ? String(b.userId) : null,
  name: b.team?.name || b.userName || "—",
  category: b.team?.name ? "Team" : "Individual",
  // "Affiliated with" — the club/company the entrant plays for (falls back to independent).
  entity: b.userId?.clubName || b.team?.name || "Independent",
  contact: b.userEmail || b.userPhone || "—",
  status: STATUS_LABEL[b.status] || "Pending",
  paymentStatus: b.paymentStatus,
  // Check-in credential encoded into the QR pass (verified at the physical desk).
  checkInToken: `IONIX:${b.tournamentId}:${b._id}`,
});

// GET /:id/registrations — all entrants for the event's linked tournament.
exports.list = async (req, res) => {
  try {
    const { agencyId, event } = await getScopedEvent(req, AgencyEvent);
    if (!agencyId) return res.status(403).json({ success: false, message: "No agency context" });
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    if (!event.linkedTournamentId) {
      return res.json({ success: true, count: 0, rows: [], stats: { total: 0, approved: 0, pending: 0 } });
    }

    const bookings = await Booking.find({ tournamentId: event.linkedTournamentId })
      .populate("userId", "clubName name")
      .sort({ createdAt: 1 })
      .lean();

    const rows = bookings.map(toRow);
    const stats = {
      total: rows.length,
      approved: rows.filter((r) => r.status === "Approved").length,
      pending: rows.filter((r) => r.status === "Pending").length,
    };
    return res.json({ success: true, count: rows.length, rows, stats });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /:id/registrations/:bookingId — approve / reject an entry.
// Mirrors BookingController.updateBookingStatus decision handling.
exports.decide = async (req, res) => {
  try {
    const agencyId = await resolveAgencyId(req);
    if (!agencyId) return res.status(403).json({ success: false, message: "No agency context" });

    const { decision, paymentMethod } = req.body;
    if (!["accepted", "rejected"].includes(decision)) {
      return res.status(400).json({ success: false, message: "decision must be 'accepted' or 'rejected'" });
    }

    // Scope: the event belongs to this agency, and the booking belongs to the event's tournament.
    const event = await AgencyEvent.findOne({ _id: req.params.id, agencyId }).lean();
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    if (!event.linkedTournamentId) {
      return res.status(400).json({ success: false, message: "Event has no linked tournament" });
    }
    const booking = await Booking.findOne({ _id: req.params.bookingId, tournamentId: event.linkedTournamentId });
    if (!booking) return res.status(404).json({ success: false, message: "Registration not found for this event" });

    if (paymentMethod && ["cash", "online"].includes(String(paymentMethod).toLowerCase())) {
      booking.paymentMethod = String(paymentMethod).toLowerCase();
    }

    if (decision === "accepted") {
      booking.status = "confirmed";
      booking.paymentStatus = "paid";
    } else {
      booking.status = "cancelled";
      booking.cancellationReason = "Rejected at registration desk";
      booking.cancellationDate = new Date();
    }
    await booking.save();

    // Notify the player (real users only — bulk-uploaded guests have no account).
    if (booking.userId) {
      try {
        const { notifyPlayer } = require("../utils/playerNotify");
        const accepted = decision === "accepted";
        await notifyPlayer(req.app, booking.userId, {
          type: accepted ? "registration_accepted" : "registration_rejected",
          title: accepted ? "Registration Confirmed" : "Registration Rejected",
          message: accepted
            ? `Your registration for "${event.name}" has been confirmed!`
            : `Your registration for "${event.name}" has been rejected.`,
          data: { tournamentId: String(event.linkedTournamentId), eventId: String(event._id), eventName: event.name },
        });
      } catch (notifErr) {
        console.error("[EVENT_REG_NOTIFY]", notifErr.message);
      }
    }

    return res.json({ success: true, message: `Registration ${booking.status}`, row: toRow(booking.toObject()) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
