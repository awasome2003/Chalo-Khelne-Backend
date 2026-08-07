const express = require("express");
const {
    upsertPaymentSetup,
    getPaymentSetup,
    deletePaymentOption,
    getQrCodes,
    getUpiIds,
    getOfflinePayments,
    getNotificationsForManager,
} = require("../controllers/managerPaymentController");
const bookingController = require("../controllers/BookingController");
const {
    getManagerPendingPayments,
    verifyPayment,
    uploadPaymentProof,
    getPlayerPaymentHistory,
    getTournamentPaymentHistory,
} = require("../controllers/playerPaymentController");
const { uploadMiddleware } = require("../middleware/uploads");
const { managerAuth, allowUserOrManager } = require("../middleware/authMiddleware");
const { requireSelf, forceSelfBody } = require("../middleware/authz");

const router = express.Router();

// ── Manager-only writes / config (manager token required) ──
// POST /setup creates the caller's own payment setup (managerId forced to self).
router.post(
    "/setup",
    managerAuth,
    forceSelfBody("managerId"),
    uploadMiddleware.array("qrCodes", 5),
    upsertPaymentSetup
);
router.get("/setup/:managerId/:tournamentId?", managerAuth, requireSelf("managerId"), getPaymentSetup);
// managerId is forced to the caller's own id (token) so a manager can only
// delete THEIR OWN payment options — the controller also reads it from the token.
router.delete("/setup/delete", managerAuth, forceSelfBody("managerId"), deletePaymentOption);
router.patch("/booking/update-status", managerAuth, bookingController.updateBookingStatus);
router.patch("/booking/bulk-update", managerAuth, bookingController.bulkUpdateBookingStatus);

// ── Payment-proof submission (player) ──
//
// §2.5: uploadPaymentProof, getPendingPayments, getPlayerPaymentHistory and
// getTournamentPaymentHistory were all written and none of them were routed.
// No PlayerPayment document could be created, so the manager's "Payment
// Reviews" screen could only ever be empty — and the emptiness was silent.
//
// playerId is taken from the token inside the controller, never from the body,
// so a player can only ever submit their own proof.
router.post(
    "/proofs",
    allowUserOrManager,
    uploadMiddleware.single("screenshot"),
    uploadPaymentProof
);

// Player's own proof history.
router.get(
    "/proofs/history/:playerId",
    allowUserOrManager,
    requireSelf("playerId"),
    getPlayerPaymentHistory
);

// ── Payment-proof review (manager reviews UPI/QR screenshots) ──
// Inbox of this manager's own pending proofs; verify is ownership-checked in the controller.
router.get("/proofs/pending/:managerId", managerAuth, requireSelf("managerId"), getManagerPendingPayments);
router.get("/proofs/tournament/:tournamentId", managerAuth, getTournamentPaymentHistory);
router.patch("/proofs/:paymentId/verify", managerAuth, verifyPayment);
router.get("/:managerId/booking-notifications", managerAuth, requireSelf("managerId"), async (req, res) => {
  try {
    const BookingNotification = require("../src/modules/social/models/Notification_Booking");
    const { managerId } = req.params;
    const notifications = await BookingNotification.find({ managerId })
      .populate("userId", "_id name email mobile profileImage")
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, notifications });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Player-facing payment info + notify (any authenticated user OR manager) ──
// QR/UPI are needed by players to pay; :managerId is the tournament's manager,
// not the caller, so we DON'T require self here — just a valid logged-in token.
router.get("/:managerId/:tournamentId/qr-codes", allowUserOrManager, getQrCodes);
router.get("/:managerId/:tournamentId/upi-ids", allowUserOrManager, getUpiIds);
router.get("/:managerId/:tournamentId/offline", allowUserOrManager, getOfflinePayments);
router.get("/:managerId/notifications", managerAuth, requireSelf("managerId"), getNotificationsForManager);

// Notify manager about a new booking/payment (called by the paying player)
router.post("/:managerId/:tournamentId/notify", allowUserOrManager, async (req, res) => {
  try {
    const { managerId, tournamentId } = req.params;
    const { userId, registrationId, paymentMethod } = req.body;

    const Notification = require("../src/modules/social/models/Notification");
    const User = require("../src/modules/identity/models/User");
    const Tournament = require("../src/modules/tournaments/models/Tournament");
    const Booking = require("../src/modules/tournaments/models/BookingModel");

    const user = await User.findById(userId).select("name").lean();
    const tournament = await Tournament.findById(tournamentId).select("title").lean();

    // Derive the amount server-side from the player's booking fee. A client-
    // supplied amount is NOT trusted: it only feeds a display string, but a
    // spoofed value could mislead the manager reviewing the proof. Falls back
    // totalFee → paymentAmount → 0. (Same lookup verifyPayment uses.)
    const booking = await Booking.findOne({ userId, tournamentId })
      .select("totalFee paymentAmount")
      .lean();
    const amount = booking ? booking.totalFee || booking.paymentAmount || 0 : 0;

    const notification = await Notification.create({
      managerId,
      tournamentId,
      userId,
      registrationId: registrationId || `reg_${Date.now()}`,
      amount,
      paymentMethod: paymentMethod === "online" ? "online" : "cash",
      message: `${user?.name || "A player"} registered for "${tournament?.title || "tournament"}" via ${paymentMethod || "cash"} (₹${amount})`,
    });

    res.json({
      success: true,
      message: "Manager notified",
      notificationId: notification._id,
      notification: notification.message,
    });
  } catch (err) {
    console.error("[NOTIFY_MANAGER] Error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
