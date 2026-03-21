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

module.exports = router;
