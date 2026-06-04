const express = require("express");
const router = express.Router();
const couponController = require("../controllers/couponController");
const { authenticate, managerAuth } = require("../middleware/authMiddleware");
const { requireOwner } = require("../middleware/authz");

// Authenticated — validate coupon (player at checkout)
router.post("/validate", authenticate, couponController.validate);

// Authenticated — get available coupons for a booking type
router.get("/available", authenticate, async (req, res) => {
  try {
    const { type, item_id } = req.query; // type: facility|tournament, item_id: turfId|tournamentId
    const now = new Date();
    const filter = {
      isActive: true,
      expiryDate: { $gt: now },
      $or: [
        { applicableTo: "all" },
        ...(type ? [{ applicableTo: type }] : []),
      ],
    };

    // If searching for specific item, include coupons for that item OR general ones
    if (item_id) {
      filter.$or = [
        { applicableTo: "all" },
        { applicableTo: type, applicableId: null },
        { applicableTo: type, applicableId: item_id },
      ];
    }

    const coupons = await require("../Modal/Coupon").find(filter)
      .select("code discountType discountValue applicableTo applicableName minAmount maxDiscount description expiryDate usageLimit usedCount")
      .sort({ discountValue: -1 })
      .limit(10)
      .lean();

    // Filter out exhausted coupons
    const available = coupons.filter(c => !c.usageLimit || c.usedCount < c.usageLimit);

    res.json({ success: true, coupons: available });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Authenticated — record usage after booking
router.post("/record-usage", authenticate, couponController.recordUsage);

// Manager — CRUD
router.post("/create", managerAuth, couponController.create);
router.get("/list", managerAuth, couponController.list);
router.get("/analytics", managerAuth, couponController.analytics);
router.put("/toggle/:id", managerAuth, requireOwner({ model: "Coupon", ownerField: "createdBy", idParam: "id" }), couponController.toggle);
router.delete("/:id", managerAuth, requireOwner({ model: "Coupon", ownerField: "createdBy", idParam: "id" }), couponController.delete);

module.exports = router;
