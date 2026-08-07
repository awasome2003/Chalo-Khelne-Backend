const Coupon = require("../src/modules/commerce/models/Coupon");
const CouponUsage = require("../src/modules/commerce/models/CouponUsage");
const mongoose = require("mongoose");
const { quoteCoupon } = require("../services/couponService");

const couponController = {
  // ═══════════════════════════════════════════
  // CREATE COUPON (Manager / ClubAdmin)
  // ═══════════════════════════════════════════
  create: async (req, res) => {
    try {
      const {
        code,
        discountType,
        discountValue,
        applicableTo,
        applicableId,
        applicableName,
        usageLimit,
        perUserLimit,
        expiryDate,
        minAmount,
        maxDiscount,
        description,
        createdBy,
        createdByName,
        createdByModel,
      } = req.body;

      if (!code || !discountType || discountValue === undefined || !applicableTo || !expiryDate) {
        return res.status(400).json({
          success: false,
          message: "code, discountType, discountValue, applicableTo, and expiryDate are required",
        });
      }

      // Validate discount value
      if (discountType === "percentage" && (discountValue < 1 || discountValue > 100)) {
        return res.status(400).json({
          success: false,
          message: "Percentage discount must be between 1 and 100",
        });
      }

      if (discountType === "flat" && discountValue < 1) {
        return res.status(400).json({
          success: false,
          message: "Flat discount must be at least ₹1",
        });
      }

      // Check expiry is in the future
      if (new Date(expiryDate) <= new Date()) {
        return res.status(400).json({
          success: false,
          message: "Expiry date must be in the future",
        });
      }

      // Check duplicate code
      const exists = await Coupon.findOne({ code: code.toUpperCase() });
      if (exists) {
        return res.status(409).json({
          success: false,
          message: `Coupon code "${code.toUpperCase()}" already exists`,
        });
      }

      const coupon = await Coupon.create({
        code: code.toUpperCase().trim(),
        discountType,
        discountValue,
        applicableTo,
        applicableId: applicableId || null,
        applicableName: applicableName || null,
        usageLimit: usageLimit || null,
        perUserLimit: perUserLimit || 1,
        expiryDate,
        minAmount: minAmount || 0,
        maxDiscount: maxDiscount || null,
        description: description || "",
        createdBy,
        createdByName,
        createdByModel: createdByModel || "Manager",
      });

      res.status(201).json({ success: true, message: "Coupon created", coupon });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ success: false, message: "Coupon code already exists" });
      }
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // ═══════════════════════════════════════════
  // VALIDATE COUPON — preview only, no side effects
  // ═══════════════════════════════════════════
  //
  // §2.7(b): the per-user limit used to be checked against `user_id` from the
  // REQUEST BODY, inside `if (user_id) { … }` — so omitting the field skipped
  // the guard entirely. The route is authenticated; the user now comes from the
  // token and the body value is ignored.
  //
  // This endpoint no longer decides anything binding. It renders a price for
  // the UI; the authoritative evaluation happens again inside redeemCoupon at
  // booking time, in the same transaction as the booking write.
  validate: async (req, res) => {
    try {
      const { code, applicable_id, applicable_type, total_amount } = req.body;

      if (!code || total_amount === undefined || total_amount === null) {
        return res.status(400).json({
          success: false,
          valid: false,
          message: "Coupon code and total_amount are required",
        });
      }

      const userId = req.user?.id || req.user?._id || req.user?.userId;

      const quote = await quoteCoupon({
        code,
        userId,
        applicableTo: applicable_type,
        applicableId: applicable_id,
        totalAmount: total_amount,
      });

      if (!quote.valid) {
        return res.json({ success: true, valid: false, message: quote.message });
      }

      return res.json({
        success: true,
        valid: true,
        message: quote.message,
        coupon_id: quote.coupon._id,
        code: quote.coupon.code,
        discount_type: quote.coupon.discountType,
        discount_value: quote.coupon.discountValue,
        discount_amount: quote.discountAmount,
        final_amount: quote.finalAmount,
        original_amount: Math.round(Number(total_amount)),
      });
    } catch (err) {
      res.status(500).json({ success: false, valid: false, message: err.message });
    }
  },

  // ═══════════════════════════════════════════
  // RECORD USAGE — REMOVED (§2.7c)
  // ═══════════════════════════════════════════
  //
  // This used to be a second, unlinked call that the client was trusted to
  // make after a booking. Nothing tied it to the booking it was supposedly
  // recording: no reservation, no booking reference, no expiry. A client that
  // validated and never called it kept the coupon good forever for everyone,
  // because usedCount never rose and no CouponUsage row was written. It also
  // wrote originalAmount/discountAmount/finalAmount straight from the request
  // body into the ledger the manager's analytics endpoint sums.
  //
  // Redemption is now part of creating the booking — see
  // services/couponService.js#redeemCoupon, called inside the booking
  // transaction in BookingController.createBooking. Do not reintroduce a
  // standalone client-driven redemption endpoint.

  // ═══════════════════════════════════════════
  // LIST COUPONS (Manager dashboard)
  // ═══════════════════════════════════════════
  list: async (req, res) => {
    try {
      const { createdBy, applicableTo, active, page = 1, limit = 20 } = req.query;
      const filter = {};

      if (createdBy) filter.createdBy = createdBy;
      if (applicableTo) filter.applicableTo = applicableTo;
      if (active !== undefined) filter.isActive = active === "true";

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const [coupons, total] = await Promise.all([
        Coupon.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
        Coupon.countDocuments(filter),
      ]);

      // Add status info
      const now = new Date();
      const enriched = coupons.map((c) => ({
        ...c,
        isExpired: new Date(c.expiryDate) <= now,
        isExhausted: c.usageLimit ? c.usedCount >= c.usageLimit : false,
        remainingUses: c.usageLimit ? c.usageLimit - c.usedCount : null,
      }));

      res.json({ success: true, coupons: enriched, total, page: parseInt(page) });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // ═══════════════════════════════════════════
  // TOGGLE COUPON STATUS
  // ═══════════════════════════════════════════
  toggle: async (req, res) => {
    try {
      const coupon = await Coupon.findById(req.params.id);
      if (!coupon) return res.status(404).json({ success: false, message: "Coupon not found" });

      coupon.isActive = !coupon.isActive;
      await coupon.save();

      res.json({
        success: true,
        message: `Coupon ${coupon.isActive ? "activated" : "deactivated"}`,
        coupon,
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // ═══════════════════════════════════════════
  // DELETE COUPON
  // ═══════════════════════════════════════════
  delete: async (req, res) => {
    try {
      const coupon = await Coupon.findById(req.params.id);
      if (!coupon) return res.status(404).json({ success: false, message: "Coupon not found" });

      if (coupon.usedCount > 0) {
        return res.status(400).json({
          success: false,
          message: "Cannot delete a coupon that has been used. Deactivate it instead.",
        });
      }

      await Coupon.findByIdAndDelete(req.params.id);
      res.json({ success: true, message: "Coupon deleted" });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // ═══════════════════════════════════════════
  // COUPON ANALYTICS
  // ═══════════════════════════════════════════
  analytics: async (req, res) => {
    try {
      const { createdBy } = req.query;
      const filter = {};
      if (createdBy) filter.createdBy = new mongoose.Types.ObjectId(createdBy);

      const now = new Date();
      const [totalCoupons, activeCoupons, totalUsage, revenueImpact] = await Promise.all([
        Coupon.countDocuments(filter),
        Coupon.countDocuments({ ...filter, isActive: true, expiryDate: { $gt: now } }),
        CouponUsage.countDocuments(),
        CouponUsage.aggregate([
          { $group: { _id: null, totalDiscount: { $sum: "$discountAmount" }, totalRevenue: { $sum: "$finalAmount" } } },
        ]),
      ]);

      res.json({
        success: true,
        stats: {
          totalCoupons,
          activeCoupons,
          totalUsage,
          totalDiscountGiven: revenueImpact[0]?.totalDiscount || 0,
          totalRevenueAfterDiscount: revenueImpact[0]?.totalRevenue || 0,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
};

module.exports = couponController;
