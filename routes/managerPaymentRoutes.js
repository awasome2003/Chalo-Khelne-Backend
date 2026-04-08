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
const { uploadMiddleware } = require("../middleware/uploads");

const router = express.Router();

router.post(
    "/setup",
    uploadMiddleware.array("qrCodes", 5),
    upsertPaymentSetup
);

router.get("/setup/:managerId/:tournamentId?", getPaymentSetup);
router.delete("/setup/delete", deletePaymentOption);
router.get("/:managerId/:tournamentId/qr-codes", getQrCodes);
router.get("/:managerId/:tournamentId/upi-ids", getUpiIds);
router.get("/:managerId/:tournamentId/offline", getOfflinePayments);
router.patch("/booking/update-status", bookingController.updateBookingStatus);
router.patch("/booking/bulk-update", bookingController.bulkUpdateBookingStatus);
router.get("/:managerId/notifications", getNotificationsForManager);

// Notify manager about a new booking/payment
router.post("/:managerId/:tournamentId/notify", async (req, res) => {
  try {
    const { managerId, tournamentId } = req.params;
    const { userId, amount, registrationId, paymentMethod } = req.body;

    const Notification = require("../Modal/Notification");
    const User = require("../Modal/User");
    const Tournament = require("../Modal/Tournament");

    const user = await User.findById(userId).select("name").lean();
    const tournament = await Tournament.findById(tournamentId).select("title").lean();

    const notification = await Notification.create({
      managerId,
      tournamentId,
      userId,
      registrationId: registrationId || `reg_${Date.now()}`,
      amount: amount || 0,
      paymentMethod: paymentMethod === "online" ? "online" : "cash",
      message: `${user?.name || "A player"} registered for "${tournament?.title || "tournament"}" via ${paymentMethod || "cash"} (₹${amount || 0})`,
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

// Booking notifications (turf bookings)
router.get("/:managerId/booking-notifications", async (req, res) => {
  try {
    const BookingNotification = require("../Modal/Notification_Booking");
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

module.exports = router;
