/**
 * Event Reports & Analytics controller (Phase 2 — Administration).
 * Aggregates the other event sub-resources into an operational summary, and
 * streams two PDFs (reusing the pdfkit pattern from exportController):
 *   - Sports Operating Blueprint  (full event ops report)
 *   - Participant Certificates    (one certificate page per registered player)
 */
const PDFDocument = require("pdfkit");
const AgencyEvent = require("../src/modules/events/models/AgencyEvent");
const { getScopedEvent } = require("../src/modules/events/scope");
const Booking = require("../src/modules/tournaments/models/BookingModel");
const EventStaff = require("../src/modules/events/models/EventStaff");
const EventOfficial = require("../src/modules/events/models/EventOfficial");
const EventSponsor = require("../src/modules/events/models/EventSponsor");
const EventTask = require("../src/modules/events/models/EventTask");
const EventVenue = require("../src/modules/events/models/EventVenue");
const EventEquipment = require("../src/modules/events/models/EventEquipment");
const EventFinance = require("../src/modules/events/models/EventFinance");

const AGENCY_AUTHORITY = "IONIX Sports Agency Board";

// Count COMPLETED matches for a tournament across the match collections.
async function countMatches(tournamentId) {
  if (!tournamentId) return 0;
  const collections = [
    "../src/modules/tournaments/models/Tournnamentmatch",
    "../src/modules/tournaments/models/DirectKnockoutMatch",
    "../src/modules/tournaments/models/TeamKnockoutMatches",
  ];
  let total = 0;
  for (const path of collections) {
    try {
      const Model = require(path);
      total += await Model.countDocuments({ tournamentId, status: "COMPLETED" });
    } catch { /* model/collection absent — skip */ }
  }
  return total;
}

async function gatherStats(event) {
  const eventId = event._id;
  const [bookings, staffCount, officialsCount, sponsors, matches] = await Promise.all([
    Booking.find(event.linkedTournamentId ? { tournamentId: event.linkedTournamentId } : { _id: null }).lean(),
    EventStaff.countDocuments({ eventId }),
    EventOfficial.countDocuments({ eventId }),
    EventSponsor.find({ eventId }).lean(),
    countMatches(event.linkedTournamentId),
  ]);
  const total = bookings.length;
  const verified = bookings.filter((b) => b.status === "confirmed").length;
  return {
    checkIn: { total, verified, percent: total ? Math.round((verified / total) * 100) : 0 },
    totalMatches: matches,
    staffCount,
    officialsCount,
    sponsors: { count: sponsors.length, secured: sponsors.reduce((s, x) => s + (Number(x.amount) || 0), 0) },
    participants: verified || total, // certificate-eligible
  };
}

// GET /:id/report/summary
exports.summary = async (req, res) => {
  try {
    const { agencyId, event } = await getScopedEvent(req, AgencyEvent);
    if (!agencyId) return res.status(403).json({ success: false, message: "No agency context" });
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    const stats = await gatherStats(event);
    return res.json({
      success: true,
      event: { id: String(event._id), name: event.name, sports: event.sports || [] },
      stats,
      certificate: { format: "ISO High Definition Certificate", authority: AGENCY_AUTHORITY },
    });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

// GET /:id/report/blueprint.pdf — full sports operating blueprint
exports.blueprint = async (req, res) => {
  try {
    const { agencyId, event } = await getScopedEvent(req, AgencyEvent);
    if (!agencyId) return res.status(403).json({ success: false, message: "No agency context" });
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });

    const stats = await gatherStats(event);
    const [tasks, officials, staff, venues, equipment, finance] = await Promise.all([
      EventTask.find({ eventId: event._id }).lean(),
      EventOfficial.find({ eventId: event._id }).lean(),
      EventStaff.find({ eventId: event._id }).lean(),
      EventVenue.find({ eventId: event._id }).lean(),
      EventEquipment.find({ eventId: event._id }).lean(),
      EventFinance.find({ eventId: event._id }).lean(),
    ]);

    const safe = (event.name || "event").replace(/[^a-z0-9]+/gi, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Blueprint_${safe}.pdf"`);
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);

    const H = (t) => { doc.moveDown(0.8).font("Helvetica-Bold").fontSize(14).fillColor("#0F1117").text(t); doc.moveDown(0.3).font("Helvetica").fontSize(10).fillColor("#000"); };
    const kv = (k, v) => doc.font("Helvetica").fontSize(10).fillColor("#333").text(`${k}: `, { continued: true }).font("Helvetica-Bold").fillColor("#000").text(String(v));

    doc.font("Helvetica-Bold").fontSize(22).fillColor("#15A765").text("Sports Operating Blueprint", { align: "center" });
    doc.moveDown(0.2).font("Helvetica").fontSize(12).fillColor("#111").text(event.name, { align: "center" });
    doc.font("Helvetica").fontSize(9).fillColor("#666").text(`${AGENCY_AUTHORITY} • ${(event.sports || []).join(", ") || "—"}`, { align: "center" });

    H("Operational Report Specifications");
    kv("Check-in Completion", `${stats.checkIn.percent}% Verified (${stats.checkIn.verified}/${stats.checkIn.total})`);
    kv("Total Adjudicated Matches", `${stats.totalMatches}`);
    kv("On-ground Staff Roster", `${stats.staffCount} staff`);
    kv("Officials", `${stats.officialsCount}`);
    kv("Sponsors Secured", `${stats.sponsors.count} ($${stats.sponsors.secured.toLocaleString()})`);

    if (tasks.length) { H("Checklist"); tasks.forEach((t) => doc.text(`[${t.status === "Completed" ? "x" : " "}] ${t.title}${t.sport ? ` (${t.sport})` : ""}`)); }
    if (officials.length) { H("Officials Roster"); officials.forEach((o) => doc.text(`• ${o.name}${o.role ? ` — ${o.role}` : ""}${o.court ? ` @ ${o.court}` : ""}`)); }
    if (staff.length) { H("Staff Roster"); staff.forEach((s) => doc.text(`• ${s.name}${s.role ? ` — ${s.role}` : ""} [${s.status || "—"}]`)); }
    if (venues.length) { H("Venues"); venues.forEach((v) => doc.text(`• ${v.name}${v.sport ? ` (${v.sport})` : ""} — ${v.status || "—"}`)); }
    if (equipment.length) { H("Equipment Inventory"); equipment.forEach((e) => doc.text(`• ${e.name}: ${e.available || 0}/${e.required || 0} available, ${e.missing || 0} missing, ${e.damaged || 0} damaged`)); }
    if (finance.length) {
      const inc = finance.filter((f) => f.direction === "income").reduce((s, f) => s + (Number(f.amount) || 0), 0);
      const exp = finance.filter((f) => f.direction === "expense").reduce((s, f) => s + (Number(f.amount) || 0), 0);
      H("Finance Summary"); kv("Gross Revenue", `$${inc.toLocaleString()}`); kv("Expenditures", `$${exp.toLocaleString()}`); kv("Operating Profit", `$${(inc - exp).toLocaleString()}`);
    }

    doc.end();
  } catch (err) {
    if (!res.headersSent) return res.status(500).json({ success: false, message: err.message });
    res.end();
  }
};

// GET /:id/report/certificates.pdf — one certificate page per registered participant
exports.certificates = async (req, res) => {
  try {
    const { agencyId, event } = await getScopedEvent(req, AgencyEvent);
    if (!agencyId) return res.status(403).json({ success: false, message: "No agency context" });
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    if (!event.linkedTournamentId) return res.status(400).json({ success: false, message: "Event has no registrations to certify" });

    const bookings = await Booking.find({ tournamentId: event.linkedTournamentId }).lean();
    const confirmed = bookings.filter((b) => b.status === "confirmed");
    const participants = (confirmed.length ? confirmed : bookings)
      .map((b) => b.team?.name || b.userName)
      .filter(Boolean);
    if (!participants.length) return res.status(400).json({ success: false, message: "No registered participants to certify" });

    const safe = (event.name || "event").replace(/[^a-z0-9]+/gi, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Certificates_${safe}.pdf"`);
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });
    doc.pipe(res);

    participants.forEach((name, i) => {
      if (i > 0) doc.addPage();
      const W = doc.page.width, Hh = doc.page.height;
      // Outer + inner border
      doc.save().rect(0, 0, W, Hh).fill("#0F1117");
      doc.lineWidth(3).strokeColor("#15A765").rect(28, 28, W - 56, Hh - 56).stroke();
      doc.lineWidth(1).strokeColor("#2b6b4f").rect(40, 40, W - 80, Hh - 80).stroke();
      doc.fillColor("#15A765").font("Helvetica-Bold").fontSize(16).text("IONIX SPORTS EVENTS", 0, 80, { align: "center" });
      doc.fillColor("#8b93a7").font("Helvetica").fontSize(11).text("Certificate of Participation", 0, 108, { align: "center" });
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(34).text(name, 0, Hh / 2 - 60, { align: "center" });
      doc.strokeColor("#15A765").lineWidth(1).moveTo(W / 2 - 140, Hh / 2 - 6).lineTo(W / 2 + 140, Hh / 2 - 6).stroke();
      doc.fillColor("#c7cbd6").font("Helvetica").fontSize(12)
        .text(`has participated in`, 0, Hh / 2 + 6, { align: "center" })
        .font("Helvetica-Bold").fillColor("#ffffff").fontSize(15).text(event.name, 0, Hh / 2 + 26, { align: "center" });
      doc.fillColor("#8b93a7").font("Helvetica").fontSize(9)
        .text("ISO High Definition Certificate", 60, Hh - 84, { align: "left" });
      doc.fillColor("#c7cbd6").font("Helvetica-Bold").fontSize(10).text(AGENCY_AUTHORITY, -60, Hh - 86, { align: "right" });
      doc.fillColor("#8b93a7").font("Helvetica").fontSize(9).text("Authorised Signatory", -60, Hh - 72, { align: "right" });
      doc.restore();
    });

    doc.end();
  } catch (err) {
    if (!res.headersSent) return res.status(500).json({ success: false, message: err.message });
    res.end();
  }
};
