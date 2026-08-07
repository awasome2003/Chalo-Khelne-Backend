/**
 * Club Reports & Analytics controller (Club OS). Tenant-scoped by clubId.
 * Real aggregation across the club modules + CSV/PDF exports (reuses pdfkit,
 * mirroring the agency eventReportController).
 */
const PDFDocument = require("pdfkit");
const ClubFinance = require("../src/modules/club/models/ClubFinance");
const ClubBooking = require("../src/modules/club/models/ClubBooking");
const ClubMember = require("../src/modules/club/models/ClubMember");
const ClubCourt = require("../src/modules/club/models/ClubCourt");
const ClubCoach = require("../src/modules/club/models/ClubCoach");
const ClubStaff = require("../src/modules/club/models/ClubStaff");
const ClubInventory = require("../src/modules/club/models/ClubInventory");
const { resolveClubId } = require("../src/modules/club/scope");

async function gather(clubId) {
  const [finance, bookings, members, courts, coaches, staff, inventory] = await Promise.all([
    ClubFinance.find({ clubId }).lean(),
    ClubBooking.find({ clubId }).lean(),
    ClubMember.find({ clubId }).lean(),
    ClubCourt.find({ clubId }).lean(),
    ClubCoach.find({ clubId }).lean(),
    ClubStaff.find({ clubId }).lean(),
    ClubInventory.find({ clubId }).lean(),
  ]);

  const income = finance.filter((f) => f.type === "Income");
  const totalIncome = income.reduce((s, f) => s + (Number(f.amount) || 0), 0);
  const totalExpense = finance.filter((f) => f.type === "Expense").reduce((s, f) => s + (Number(f.amount) || 0), 0);
  const gstCollected = income.reduce((s, f) => s + (Number(f.gstAmount) || 0), 0);

  // Revenue channels = income grouped by category, with share %.
  const byCat = {};
  for (const f of income) byCat[f.category] = (byCat[f.category] || 0) + (Number(f.amount) || 0);
  const channels = Object.entries(byCat)
    .map(([channel, revenue]) => ({ channel, revenue, share: totalIncome ? Math.round((revenue / totalIncome) * 100) : 0 }))
    .sort((a, b) => b.revenue - a.revenue);

  return {
    revenue: { totalIncome, totalExpense, netProfit: totalIncome - totalExpense, gstCollected },
    channels,
    counts: {
      bookings: bookings.length,
      confirmedBookings: bookings.filter((b) => b.status === "Confirmed").length,
      members: members.length,
      activeMembers: members.filter((m) => m.status === "Active").length,
      courts: courts.length,
      coaches: coaches.length,
      staff: staff.length,
      inventoryItems: inventory.length,
      lowStock: inventory.filter((i) => i.quantity <= i.minAlertThreshold).length,
    },
    memberBreakdown: {
      Active: members.filter((m) => m.status === "Active").length,
      Expired: members.filter((m) => m.status === "Expired").length,
      Pending: members.filter((m) => m.status === "Pending").length,
      Blocked: members.filter((m) => m.status === "Blocked").length,
    },
    _finance: finance,
  };
}

exports.summary = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    const data = await gather(clubId);
    delete data._finance;
    return res.json({ success: true, ...data });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

// GET /reports/finance.csv — the full finance ledger as CSV.
exports.financeCsv = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    const rows = await ClubFinance.find({ clubId }).sort({ date: -1, createdAt: -1 }).lean();
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Date", "Type", "Category", "Amount", "GST", "Method", "Reference", "Description"];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push([
        new Date(r.date).toISOString().slice(0, 10), r.type, r.category, r.amount, r.gstAmount || 0,
        r.paymentMethod, r.referenceId, r.description,
      ].map(esc).join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="club_finance_ledger.csv"`);
    return res.send(lines.join("\n"));
  } catch (err) {
    if (!res.headersSent) return res.status(500).json({ success: false, message: err.message });
    res.end();
  }
};

// GET /reports/report.pdf — a business-intelligence PDF.
exports.reportPdf = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    const d = await gather(clubId);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="club_business_report.pdf"`);
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);

    const H = (t) => { doc.moveDown(0.8).font("Helvetica-Bold").fontSize(14).fillColor("#0F1117").text(t); doc.moveDown(0.3).font("Helvetica").fontSize(10).fillColor("#000"); };
    const kv = (k, v) => doc.font("Helvetica").fontSize(10).fillColor("#333").text(`${k}: `, { continued: true }).font("Helvetica-Bold").fillColor("#000").text(String(v));

    doc.font("Helvetica-Bold").fontSize(22).fillColor("#15A765").text("Club Business Report", { align: "center" });
    doc.moveDown(0.2).font("Helvetica").fontSize(9).fillColor("#666").text("Facility operations, revenue channels & GST ledger", { align: "center" });

    H("Revenue Summary");
    kv("Total Income", `Rs. ${d.revenue.totalIncome.toLocaleString()}`);
    kv("Total Expense", `Rs. ${d.revenue.totalExpense.toLocaleString()}`);
    kv("Net Profit", `Rs. ${d.revenue.netProfit.toLocaleString()}`);
    kv("GST Collected", `Rs. ${d.revenue.gstCollected.toLocaleString()}`);

    if (d.channels.length) { H("Revenue Channels"); d.channels.forEach((c) => doc.text(`• ${c.channel}: Rs. ${c.revenue.toLocaleString()} (${c.share}%)`)); }

    H("Operations");
    kv("Bookings (confirmed / total)", `${d.counts.confirmedBookings} / ${d.counts.bookings}`);
    kv("Members (active / total)", `${d.counts.activeMembers} / ${d.counts.members}`);
    kv("Courts", d.counts.courts);
    kv("Coaches", d.counts.coaches);
    kv("Staff", d.counts.staff);
    kv("Inventory items (low-stock)", `${d.counts.inventoryItems} (${d.counts.lowStock})`);

    H("Membership Breakdown");
    Object.entries(d.memberBreakdown).forEach(([k, v]) => doc.text(`• ${k}: ${v}`));

    doc.end();
  } catch (err) {
    if (!res.headersSent) return res.status(500).json({ success: false, message: err.message });
    res.end();
  }
};
