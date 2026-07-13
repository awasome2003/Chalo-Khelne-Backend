/**
 * Club Finance ledger controller (Club OS foundation). Tenant-scoped by clubId.
 * The full Finance & POS UI is a later module; this backs the auto-posting from
 * bookings/rentals and the dashboard revenue KPIs.
 */
const ClubFinance = require("../src/modules/club/models/ClubFinance");
const { resolveClubId } = require("../src/modules/club/scope");
const { postClubFinance, logClubAudit } = require("../src/modules/club/automation");

const summarize = (items) => {
  let income = 0, expense = 0, gst = 0;
  for (const i of items) {
    const a = Number(i.amount) || 0;
    if (i.type === "Income") { income += a; gst += Number(i.gstAmount) || 0; } else expense += a;
  }
  return { totalIncome: income, totalExpense: expense, netProfit: income - expense, gstCollected: gst, count: items.length };
};

exports.list = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    const items = await ClubFinance.find({ clubId }).sort({ date: -1, createdAt: -1 }).lean();
    return res.json({ success: true, count: items.length, items, summary: summarize(items) });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

// Manual journal entry (offline cash, utility bills, etc.).
exports.create = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    const { type, category, amount, description, paymentMethod } = req.body;
    if (!["Income", "Expense"].includes(type)) return res.status(400).json({ success: false, message: "type must be Income or Expense" });
    if (!(Number(amount) > 0)) return res.status(400).json({ success: false, message: "amount must be greater than 0" });
    const item = await postClubFinance(clubId, { type, category, amount, description, paymentMethod, createdBy: req.user?.id || null, withGst: type === "Income" });
    await logClubAudit(clubId, { action: "Record Cash Journal", module: "Finance", details: `${type} posted: ${description || category} (${amount})` });
    const items = await ClubFinance.find({ clubId }).sort({ date: -1, createdAt: -1 }).lean();
    return res.status(201).json({ success: true, item, summary: summarize(items) });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};
