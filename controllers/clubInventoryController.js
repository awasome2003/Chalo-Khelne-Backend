/**
 * Club Inventory controller (Club OS). Tenant-scoped by clubId. Renting an item
 * auto-posts Equipment Rental income + audit; restock bumps quantity.
 */
const ClubInventory = require("../src/modules/club/models/ClubInventory");
const { resolveClubId } = require("../src/modules/club/scope");
const { postClubFinance, logClubAudit } = require("../src/modules/club/automation");

const today = () => new Date().toISOString().slice(0, 10);
const FIELDS = ["name", "category", "quantity", "minAlertThreshold", "unitPrice"];

exports.list = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    const items = await ClubInventory.find({ clubId }).sort({ createdAt: 1 }).lean();
    const stats = {
      total: items.length,
      lowStock: items.filter((i) => i.quantity <= i.minAlertThreshold).length,
      stockValue: items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0),
    };
    return res.json({ success: true, count: items.length, items, stats });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.create = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    if (!req.body.name || !String(req.body.name).trim()) return res.status(400).json({ success: false, message: "Item name is required" });
    const payload = { clubId, createdBy: req.user?.id || null, lastRestocked: today() };
    for (const k of FIELDS) if (req.body[k] !== undefined) payload[k] = req.body[k];
    const item = await ClubInventory.create(payload);
    await logClubAudit(clubId, { action: "Provision Stock", module: "Inventory", details: `Added stock: ${item.name}` });
    return res.status(201).json({ success: true, item });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.update = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const update = {};
    for (const k of FIELDS) if (req.body[k] !== undefined) update[k] = req.body[k];
    const item = await ClubInventory.findOneAndUpdate({ _id: req.params.itemId, clubId }, update, { new: true, runValidators: true });
    if (!item) return res.status(404).json({ success: false, message: "Item not found" });
    return res.json({ success: true, item });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.restock = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const qty = Number(req.body.qty);
    if (!(qty > 0)) return res.status(400).json({ success: false, message: "qty must be greater than 0" });
    const item = await ClubInventory.findOne({ _id: req.params.itemId, clubId });
    if (!item) return res.status(404).json({ success: false, message: "Item not found" });
    item.quantity += qty; item.lastRestocked = today();
    await item.save();
    await logClubAudit(clubId, { action: "Restock Warehouse", module: "Inventory", details: `Restocked ${item.name} (+${qty})` });
    return res.json({ success: true, item });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

// Rent/sell stock → decrement quantity + post Equipment Rental income.
exports.rent = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const qty = Number(req.body.qty);
    const customerName = String(req.body.customerName || "Walk-in").trim() || "Walk-in";
    if (!(qty > 0)) return res.status(400).json({ success: false, message: "qty must be greater than 0" });
    const item = await ClubInventory.findOne({ _id: req.params.itemId, clubId });
    if (!item) return res.status(404).json({ success: false, message: "Item not found" });
    if (item.quantity < qty) return res.status(400).json({ success: false, message: `Only ${item.quantity} in stock` });
    item.quantity -= qty;
    await item.save();
    const total = (Number(item.unitPrice) || 0) * qty;
    await logClubAudit(clubId, { action: "Rent Equipment", module: "Inventory", details: `${customerName} rented ${qty}× ${item.name}` });
    if (total > 0) await postClubFinance(clubId, { type: "Income", category: "Equipment Rental", amount: total, paymentMethod: "Cash", description: `POS rental: ${customerName} — ${qty}× ${item.name}`, sourceType: "inventory", sourceId: item._id, createdBy: req.user?.id || null });
    return res.json({ success: true, item });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.remove = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const item = await ClubInventory.findOneAndDelete({ _id: req.params.itemId, clubId });
    if (!item) return res.status(404).json({ success: false, message: "Item not found" });
    await logClubAudit(clubId, { action: "Remove Stock", module: "Inventory", details: `Removed ${item.name}` });
    return res.json({ success: true, message: "Item removed" });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};
