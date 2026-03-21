const PlayerPayment = require("../Modal/playerPaymentSchema");

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
        } = req.body;

        if (!playerId || !managerId || !tournamentId || !paymentMethod) {
            return res.status(400).json({ message: "Missing required fields" });
        }

        let screenshot = null;
        if (req.file) {
            screenshot = req.file.path;
        }

        // Create new payment record
        const payment = new PlayerPayment({
            playerId,
            managerId,
            tournamentId,
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

// 3️⃣ Manager verifies payment
exports.verifyPayment = async (req, res) => {
    try {
        const { paymentId } = req.params;
        const { status, managerId } = req.body; // managerId needed for updatedBy

        if (!["approved", "rejected"].includes(status)) {
            return res.status(400).json({ message: "Invalid status" });
        }

        const payment = await PlayerPayment.findById(paymentId);
        if (!payment) {
            return res.status(404).json({ message: "Payment not found" });
        }

        payment.status = status;
        payment.updatedBy = managerId;
        payment.updatedAt = new Date();

        await payment.save();

        res.status(200).json({
            success: true,
            message: `Payment ${status} successfully`,
            data: payment,
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
