/**
 * Razorpay payment routes (Chalo Khelne). Mounted at /api/razorpay.
 * Real gateway order-create + server-side signature verification — a booking is
 * marked paid ONLY after /verify (or a verified /webhook) confirms the payment.
 */
const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/razorpayController");
const { authenticate } = require("../middleware/authMiddleware");

// Authenticated: open a checkout order, then confirm the signed callback.
router.post("/order", authenticate, ctrl.createOrder);
router.post("/verify", authenticate, ctrl.verify);

// Public but HMAC-verified (Razorpay server → us). rawBody captured in app.js.
router.post("/webhook", ctrl.webhook);

module.exports = router;
