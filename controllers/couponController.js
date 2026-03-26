const Coupon = require("../Modal/Coupon");
const CouponUsage = require("../Modal/CouponUsage");
const mongoose = require("mongoose");

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
  // VALIDATE COUPON (Player applies during booking)
  // ═══════════════════════════════════════════
  validate: async (req, res) => {
    try {
      const { code, applicable_id, applicable_type, total_amount, user_id } = req.body;

      if (!code || !total_amount) {
        return res.status(400).json({
          success: false,
          valid: false,
          message: "Coupon code and total_amount are required",
        });
      }

      const coupon = await Coupon.findOne({ code: code.toUpperCase().trim() });

      if (!coupon) {
        return res.json({
          success: true,
          valid: false,
          message: "Invalid coupon code",
        });
      }

      // Check active
      if (!coupon.isActive) {
        return res.json({
          success: true,
          valid: false,
          message: "This coupon is no longer active",
        });
      }

      // Check expiry
      if (new Date(coupon.expiryDate) <= new Date()) {
        return res.json({
          success: true,
          valid: false,
          message: "This coupon has expired",
        });
      }

      // Check global usage limit
      if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
        return res.json({
          success: true,
          valid: false,
          message: "This coupon has reached its usage limit",
        });
      }

      // Check applicability
      if (coupon.applicableTo !== "all" && applicable_type) {
        if (coupon.applicableTo !== applicable_type) {
          return res.json({
            success: true,
            valid: false,
            message: `This coupon is only valid for ${coupon.applicableTo} bookings`,
          });
        }
      }

      // Check specific ID applicability
      if (coupon.applicableId && applicable_id) {
        if (coupon.applicableId.toString() !== applicable_id.toString()) {
          return res.json({
            success: true,
            valid: false,
            message: "This coupon is not valid for this item",
          });
        }
      }

      // Check minimum amount
      if (total_amount < coupon.minAmount) {
        return res.json({
          success: true,
          valid: false,
          message: `Minimum order amount is ₹${coupon.minAmount}`,
        });
      }

      // Check per-user usage limit
      if (user_id) {
        const userUsageCount = await CouponUsage.countDocuments({
          couponId: coupon._id,
          userId: user_id,
        });
        if (userUsageCount >= coupon.perUserLimit) {
          return res.json({
            success: true,
            valid: false,
            message: `You have already used this coupon${coupon.perUserLimit > 1 ? ` ${coupon.perUserLimit} times` : ""}`,
          });
        }
      }

      // Calculate discount
      let discountAmount;
      if (coupon.discountType === "percentage") {
        discountAmount = Math.round((total_amount * coupon.discountValue) / 100);
        // Apply max discount cap
        if (coupon.maxDiscount && discountAmount > coupon.maxDiscount) {
          discountAmount = coupon.maxDiscount;
        }
      } else {
        discountAmount = coupon.discountValue;
      }

      // Ensure discount doesn't exceed total
      if (discountAmount > total_amount) {
        discountAmount = total_amount;
      }

      const finalAmount = total_amount - discountAmount;

      res.json({
        success: true,
        valid: true,
        message: `Coupon applied! You save ₹${discountAmount}`,
        coupon_id: coupon._id,
        code: coupon.code,
        discount_type: coupon.discountType,
        discount_value: coupon.discountValue,
        discount_amount: discountAmount,
        final_amount: finalAmount,
        original_amount: total_amount,
      });
    } catch (err) {
      res.status(500).json({ success: false, valid: false, message: err.message });
    }
  },

  // ═══════════════════════════════════════════
  // RECORD USAGE (called after successful booking/payment)
  // ═══════════════════════════════════════════
  recordUsage: async (req, res) => {
    try {
      const {
        coupon_id,
        user_id,
        applied_to,
        applied_id,
        original_amount,
        discount_amount,
        final_amount,
      } = req.body;

      if (!coupon_id || !user_id || !applied_to || !applied_id) {
        return res.status(400).json({ success: false, message: "Missing required fields" });
      }

      const coupon = await Coupon.findById(coupon_id);
      if (!coupon) {
        return res.status(404).json({ success: false, message: "Coupon not found" });
      }

      // Create usage record
      await CouponUsage.create({
        couponId: coupon._id,
        userId: user_id,
        couponCode: coupon.code,
        appliedTo: applied_to,
        appliedId: applied_id,
        originalAmount: original_amount,
        discountAmount: discount_amount,
        finalAmount: final_amount,
      });

      // Increment used count
      coupon.usedCount += 1;
      await coupon.save();

      res.json({ success: true, message: "Coupon usage recorded" });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

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
