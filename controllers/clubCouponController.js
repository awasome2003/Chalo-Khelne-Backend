/**
 * Club Coupons controller (Club OS). Tenant-scoped by clubId. Codes unique per club.
 */
const ClubCoupon = require("../src/modules/club/models/ClubCoupon");
const { resolveClubId } = require("../src/modules/club/scope");
const { logClubAudit } = require("../src/modules/club/automation");

const FIELDS = ["name", "code", "discountType", "value", "validFrom", "validUntil", "usageLimit", "applicableSports", "membershipOnly", "isActive"];

exports.list = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    const coupons = await ClubCoupon.find({ clubId }).sort({ createdAt: -1 }).lean();
    return res.json({ success: true, count: coupons.length, coupons });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.create = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    if (!req.body.name || !String(req.body.name).trim()) return res.status(400).json({ success: false, message: "Coupon name is required" });
    if (!req.body.code || !String(req.body.code).trim()) return res.status(400).json({ success: false, message: "Coupon code is required" });
    const payload = { clubId, createdBy: req.user?.id || null };
    for (const k of FIELDS) if (req.body[k] !== undefined) payload[k] = req.body[k];
    const coupon = await ClubCoupon.create(payload);
    await logClubAudit(clubId, { action: "Create Coupon", module: "Marketing", details: `Created promo code: ${coupon.code}` });
    return res.status(201).json({ success: true, coupon });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ success: false, message: "A coupon with this code already exists" });
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const update = {};
    for (const k of FIELDS) if (req.body[k] !== undefined) update[k] = req.body[k];
    const coupon = await ClubCoupon.findOneAndUpdate({ _id: req.params.couponId, clubId }, update, { new: true, runValidators: true });
    if (!coupon) return res.status(404).json({ success: false, message: "Coupon not found" });
    return res.json({ success: true, coupon });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ success: false, message: "A coupon with this code already exists" });
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const coupon = await ClubCoupon.findOneAndDelete({ _id: req.params.couponId, clubId });
    if (!coupon) return res.status(404).json({ success: false, message: "Coupon not found" });
    await logClubAudit(clubId, { action: "Delete Coupon", module: "Marketing", details: `Deleted promo code: ${coupon.code}` });
    return res.json({ success: true, message: "Coupon removed" });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};
