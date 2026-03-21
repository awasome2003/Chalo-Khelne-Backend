const express = require("express");
const router = express.Router();
const { uploadMiddleware } = require("../middleware/uploads");
const {
    uploadPaymentProof,
    getPendingPayments,
    verifyPayment,
    getPlayerPaymentHistory,
    getTournamentPaymentHistory,
} = require("../controllers/playerPaymentController");

// ✅ Player uploads proof (screenshot)
router.post(
    "/upload",
    uploadMiddleware.single("screenshot"),
    uploadPaymentProof
);

// ✅ Manager: view pending payments
router.get("/pending/:tournamentId", getPendingPayments);

// ✅ Manager: verify payment (approve/reject)
// router.patch("/verify/:paymentId", verifyPayment);

// ✅ Player: view payment history
router.get("/history/player/:playerId", getPlayerPaymentHistory);

// ✅ Manager: view tournament payment history
// router.get("/history/tournament/:tournamentId", getTournamentPaymentHistory);

module.exports = router;
