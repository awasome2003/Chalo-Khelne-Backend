/**
 * Club CRM controller (Club OS). Tenant-scoped by clubId. Customer profiles are
 * auto-built from bookings/memberships (upsertClubCustomer); here the admin
 * reads them and appends coach/admin notes to the timeline.
 */
const ClubCustomer = require("../src/modules/club/models/ClubCustomer");
const { resolveClubId } = require("../src/modules/club/scope");
const { logClubAudit } = require("../src/modules/club/automation");

exports.list = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    const q = { clubId };
    if (req.query.search) {
      const rx = new RegExp(String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      q.$or = [{ name: rx }, { phone: rx }, { email: rx }];
    }
    const customers = await ClubCustomer.find(q).sort({ updatedAt: -1 }).lean();
    const stats = {
      total: customers.length,
      members: customers.filter((c) => c.membershipStatus === "Active").length,
      lifetimeValue: customers.reduce((s, c) => s + (Number(c.lifetimeSpending) || 0), 0),
    };
    return res.json({ success: true, count: customers.length, customers, stats });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

// Append an administrative / coaching note to a customer's timeline.
exports.addNote = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const text = String(req.body.note || "").trim();
    if (!text) return res.status(400).json({ success: false, message: "Note text is required" });
    const customer = await ClubCustomer.findOne({ _id: req.params.customerId, clubId });
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });
    const today = new Date().toISOString().slice(0, 10);
    customer.notes = text;
    customer.timeline.unshift({ type: "coach_note", date: today, time: "", title: "Administrative note", description: text });
    await customer.save();
    await logClubAudit(clubId, { action: "Add CRM Note", module: "CRM", details: `Note added for ${customer.name}` });
    return res.json({ success: true, customer });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.remove = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const customer = await ClubCustomer.findOneAndDelete({ _id: req.params.customerId, clubId });
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });
    return res.json({ success: true, message: "Customer removed" });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};
