const mongoose = require("mongoose");
const PlayerPayment = require("../src/modules/commerce/models/playerPaymentSchema");
const Booking = require("../src/modules/tournaments/models/BookingModel");

// Resolve the Booking a proof pays for: explicit bookingId first, then the
// player's booking for that tournament. Returns a Mongoose doc or null.
async function resolveBookingForPayment(payment) {
    if (payment.bookingId) {
        const byId = await Booking.findById(payment.bookingId);
        if (byId) return byId;
    }
    return Booking.findOne({ userId: payment.playerId, tournamentId: payment.tournamentId });
}

// 1️⃣ Player uploads payment proof
exports.uploadPaymentProof = async (req, res) => {
    try {
        const {
            playerId,
            managerId,
            tournamentId,
            paymentMethod,
            managerPaymentOptionId,
            transactionId,
            offlineReceiver, // { name, contact } if offline
            bookingId,       // optional — explicit link to the registration
        } = req.body;

        if (!playerId || !managerId || !tournamentId || !paymentMethod) {
            return res.status(400).json({ message: "Missing required fields" });
        }

        // Reject malformed ids early — clean 400 instead of a CastError 500.
        if (
            !mongoose.isValidObjectId(playerId) ||
            !mongoose.isValidObjectId(managerId) ||
            !mongoose.isValidObjectId(tournamentId) ||
            (bookingId && !mongoose.isValidObjectId(bookingId))
        ) {
            return res.status(400).json({ message: "Invalid id in request" });
        }

        let screenshot = null;
        if (req.file) {
            screenshot = req.file.path;
        }

        // Link to the player's booking for this tournament. Use the explicit
        // bookingId if the client sent one, otherwise resolve it so the
        // proof→booking link exists for the verify step.
        let resolvedBookingId = bookingId || null;
        if (!resolvedBookingId) {
            const existingBooking = await Booking.findOne({
                userId: playerId,
                tournamentId,
            }).select("_id").lean();
            if (existingBooking) resolvedBookingId = existingBooking._id;
        }

        // Create new payment record
        const payment = new PlayerPayment({
            playerId,
            managerId,
            tournamentId,
            bookingId: resolvedBookingId || undefined,
            paymentMethod,
            managerPaymentOptionId,
            transactionId,
            screenshot,
            offlineReceiver: paymentMethod === "offline" ? offlineReceiver : undefined,
        });

        await payment.save();

        res.status(201).json({
            success: true,
            message: "Payment submitted successfully",
            data: payment,
        });
    } catch (error) {
        console.error("Error uploading payment proof:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

// 2️⃣ Manager views pending payments for a tournament
exports.getPendingPayments = async (req, res) => {
    try {
        const { tournamentId } = req.params;

        const payments = await PlayerPayment.find({
            tournamentId,
            status: "pending",
        })
            .populate("playerId", "name email")
            .populate("tournamentId", "title");

        res.status(200).json({ success: true, data: payments });
    } catch (error) {
        console.error("Error fetching pending payments:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

// 2.5️⃣ Manager views ALL their pending proofs (across tournaments) — inbox feed
exports.getManagerPendingPayments = async (req, res) => {
    try {
        const { managerId } = req.params;

        const payments = await PlayerPayment.find({
            managerId,
            status: "pending",
        })
            .populate("playerId", "name email mobile profileImage")
            .populate("tournamentId", "title startDate")
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: payments });
    } catch (error) {
        console.error("Error fetching manager pending payments:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

// 3️⃣ Manager verifies payment (manual review — intended design).
//    On approval, the linked Booking is automatically confirmed + marked paid.
exports.verifyPayment = async (req, res) => {
    try {
        const { paymentId } = req.params;
        const { status } = req.body;
        const callerId = req.user?.id || req.user?._id; // managerAuth sets req.user

        if (!mongoose.isValidObjectId(paymentId)) {
            return res.status(400).json({ message: "Invalid paymentId" });
        }
        if (!["approved", "rejected"].includes(status)) {
            return res.status(400).json({ message: "Invalid status" });
        }

        const payment = await PlayerPayment.findById(paymentId);
        if (!payment) {
            return res.status(404).json({ message: "Payment not found" });
        }

        // A manager may only verify proofs submitted to them.
        if (String(payment.managerId) !== String(callerId)) {
            return res.status(403).json({ message: "Forbidden" });
        }

        // ── Idempotency (Phase 5a): a repeat call (manager double-click or a
        // gateway retry) must NOT re-process. If the payment is already in the
        // requested state, return the existing record without touching the
        // booking again — never double-confirm. ──
        if (payment.status === status) {
            const existingBooking = status === "approved"
                ? await resolveBookingForPayment(payment)
                : null;
            return res.status(200).json({
                success: true,
                message: `Payment already ${status}`,
                data: payment,
                booking: existingBooking || undefined,
                idempotent: true,
            });
        }

        payment.status = status;
        payment.updatedBy = callerId;
        payment.updatedAt = new Date();

        // ── On approval, confirm the linked booking (proof → booking link) ──
        // Mirrors updateBookingStatus's "accepted" semantics. We do NOT touch
        // the booking on rejection — the player can re-submit a corrected proof,
        // and the manager keeps full manual control over the booking lifecycle.
        // Resolve + stage the booking changes here (read-only); the actual writes
        // happen together inside the transaction below.
        let linkedBooking = null;
        let bookingNeedsSave = false;
        if (status === "approved") {
            linkedBooking = await resolveBookingForPayment(payment);

            if (linkedBooking) {
                // Backfill the link if it was resolved heuristically.
                if (!payment.bookingId) payment.bookingId = linkedBooking._id;

                if (linkedBooking.status !== "confirmed" || linkedBooking.paymentStatus !== "paid") {
                    linkedBooking.status = "confirmed";
                    linkedBooking.paymentStatus = "paid";
                    bookingNeedsSave = true;
                }
            } else {
                console.warn(
                    `[VERIFY_PAYMENT] Approved payment ${payment._id} but found no booking to confirm ` +
                    `(player=${payment.playerId}, tournament=${payment.tournamentId}).`
                );
            }
        }

        // ── Atomic (Phase 5a): the booking confirmation and the payment status
        // update commit together or not at all. Previously these were two
        // separate saves — a failed payment.save() left the booking confirmed +
        // paid while the payment stayed pending (money/state mismatch). ──
        const { runInTransaction } = require("../src/platform/db");
        await runInTransaction(async (session) => {
            if (bookingNeedsSave) await linkedBooking.save({ session });
            await payment.save({ session });
        });

        // Best-effort player notification (does not block the response).
        if (status === "approved" && linkedBooking) {
            try {
                const { notifyPlayer } = require("../utils/playerNotify");
                const Tournament = require("../src/modules/tournaments/models/Tournament");
                const tournament = await Tournament.findById(payment.tournamentId).select("title").lean();
                const tName = tournament?.title || "Tournament";
                await notifyPlayer(req.app, payment.playerId, {
                    type: "registration_accepted",
                    title: "Payment Verified — Registration Confirmed",
                    message: `Your payment for "${tName}" was verified and your registration is confirmed!`,
                    data: { tournamentId: payment.tournamentId, tournamentName: tName },
                });
            } catch (notifErr) {
                console.error("[VERIFY_PAYMENT_NOTIFY] Error:", notifErr.message);
            }
        }

        res.status(200).json({
            success: true,
            message: `Payment ${status} successfully`,
            data: payment,
            booking: linkedBooking || undefined,
        });
    } catch (error) {
        console.error("Error verifying payment:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

// 4️⃣ Player payment history
exports.getPlayerPaymentHistory = async (req, res) => {
    try {
        const { playerId } = req.params;

        const payments = await PlayerPayment.find({ playerId })
            .populate("tournamentId", "title startDate endDate")
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: payments });
    } catch (error) {
        console.error("Error fetching player history:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

// 5️⃣ Manager payment history for a tournament
exports.getTournamentPaymentHistory = async (req, res) => {
    try {
        const { tournamentId } = req.params;

        const payments = await PlayerPayment.find({ tournamentId })
            .populate("playerId", "name email")
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: payments });
    } catch (error) {
        console.error("Error fetching tournament history:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};
