/**
 * Club dashboard summary (Club OS). Aggregates the modules that exist so far
 * (courts, bookings, finance, audit) into the dashboard KPIs. Modules not yet
 * built (members/coaches/staff/tournaments) report 0/empty — the UI degrades
 * gracefully and lights up as each module ships.
 */
const ClubCourt = require("../src/modules/club/models/ClubCourt");
const ClubBooking = require("../src/modules/club/models/ClubBooking");
const ClubFinance = require("../src/modules/club/models/ClubFinance");
const ClubAudit = require("../src/modules/club/models/ClubAudit");
const ClubMember = require("../src/modules/club/models/ClubMember");
const { resolveClubId } = require("../src/modules/club/scope");

exports.summary = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    const today = new Date().toISOString().slice(0, 10);

    const [courts, bookings, finance, audit, members] = await Promise.all([
      ClubCourt.find({ clubId }).lean(),
      ClubBooking.find({ clubId, status: "Confirmed" }).lean(),
      ClubFinance.find({ clubId, type: "Income" }).lean(),
      ClubAudit.find({ clubId }).sort({ createdAt: -1 }).limit(6).lean(),
      ClubMember.find({ clubId }).lean(),
    ]);

    const unpaid = bookings.filter((b) => !b.isPaid);
    const occupied = courts.filter((c) => c.status === "Occupied");

    const stats = {
      todayBookings: bookings.filter((b) => b.date === today).length,
      liveMatches: occupied.length,
      activeMembers: members.filter((m) => m.status === "Active").length,
      expiredMembers: members.filter((m) => m.status === "Expired").length,
      totalRevenue: finance.reduce((s, f) => s + (Number(f.amount) || 0), 0),
      pendingAmount: unpaid.reduce((s, b) => s + (Number(b.amount) || 0), 0),
      pendingCount: unpaid.length,
      upcomingTournaments: 0,
      availableCourts: courts.filter((c) => c.status === "Available").length,
      totalCourts: courts.length,
      coachesAvailable: 0, staffOnDuty: 0, totalStaff: 0,
      newMemberRequests: members.filter((m) => m.status === "Pending").length,
      liveActivity: occupied.map((c) => ({ tag: "COURT IN USE", title: `${c.name} (${c.sport})`, subtitle: `${c.isIndoor ? "Indoor" : "Outdoor"} • ${c.operatingHours}` })),
      pendingPayments: unpaid.slice(0, 8).map((b) => ({ customerName: b.customerName, courtName: b.courtName, startTime: b.startTime, amount: b.amount })),
      auditLogs: audit.map((a) => ({ user: a.user, module: a.module, action: a.action, details: a.details, time: new Date(a.createdAt).toISOString().slice(11, 16) })),
    };
    return res.json({ success: true, stats });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};
