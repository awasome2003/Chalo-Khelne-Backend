/**
 * Event Finance Ledger controller (Phase 2 — Administration).
 * Agency-scoped income/expense lines + a derived balance sheet.
 */
const AgencyEvent = require("../src/modules/events/models/AgencyEvent");
const EventFinance = require("../src/modules/events/models/EventFinance");
const { resolveAgencyId, getScopedEvent } = require("../src/modules/events/scope");

const FIELDS = ["direction", "category", "details", "amount", "status", "date"];

// Balance sheet — reproduces the IONIX prototype's numbers:
//   projectedGrossRevenue = all income
//   realizedReceivedCash  = income marked Paid
//   totalExpenditures     = all expenses (paid + pending)
//   operatingProfit       = realized cash − total expenditures
const summarize = (items) => {
  let projectedGrossRevenue = 0, realizedReceivedCash = 0, totalExpenditures = 0;
  for (const i of items) {
    const amt = Number(i.amount) || 0;
    if (i.direction === "income") {
      projectedGrossRevenue += amt;
      if (i.status === "Paid") realizedReceivedCash += amt;
    } else {
      totalExpenditures += amt;
    }
  }
  return {
    projectedGrossRevenue,
    realizedReceivedCash,
    totalExpenditures,
    operatingProfit: realizedReceivedCash - totalExpenditures,
  };
};

exports.list = async (req, res) => {
  try {
    const { agencyId, event } = await getScopedEvent(req, AgencyEvent);
    if (!agencyId) return res.status(403).json({ success: false, message: "No agency context" });
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    const items = await EventFinance.find({ eventId: event._id }).sort({ date: -1, createdAt: -1 }).lean();
    return res.json({ success: true, count: items.length, items, summary: summarize(items) });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.create = async (req, res) => {
  try {
    const { agencyId, event } = await getScopedEvent(req, AgencyEvent);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    if (!["income", "expense"].includes(req.body.direction)) {
      return res.status(400).json({ success: false, message: "direction must be 'income' or 'expense'" });
    }
    if (!(Number(req.body.amount) > 0)) {
      return res.status(400).json({ success: false, message: "amount must be greater than 0" });
    }
    const payload = { eventId: event._id, agencyId, createdBy: req.user?.id || null };
    for (const k of FIELDS) if (req.body[k] !== undefined) payload[k] = req.body[k];
    const item = await EventFinance.create(payload);
    const items = await EventFinance.find({ eventId: event._id }).sort({ date: -1, createdAt: -1 }).lean();
    return res.status(201).json({ success: true, item, summary: summarize(items) });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.update = async (req, res) => {
  try {
    const agencyId = await resolveAgencyId(req);
    const update = {};
    for (const k of FIELDS) if (req.body[k] !== undefined) update[k] = req.body[k];
    const item = await EventFinance.findOneAndUpdate(
      { _id: req.params.entryId, eventId: req.params.id, agencyId }, update,
      { new: true, runValidators: true }
    );
    if (!item) return res.status(404).json({ success: false, message: "Entry not found" });
    const items = await EventFinance.find({ eventId: req.params.id }).sort({ date: -1, createdAt: -1 }).lean();
    return res.json({ success: true, item, summary: summarize(items) });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.remove = async (req, res) => {
  try {
    const agencyId = await resolveAgencyId(req);
    const item = await EventFinance.findOneAndDelete({ _id: req.params.entryId, eventId: req.params.id, agencyId });
    if (!item) return res.status(404).json({ success: false, message: "Entry not found" });
    const items = await EventFinance.find({ eventId: req.params.id }).sort({ date: -1, createdAt: -1 }).lean();
    return res.json({ success: true, message: "Entry removed", summary: summarize(items) });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};
