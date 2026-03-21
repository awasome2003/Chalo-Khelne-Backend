const ManagerPayment = require("../Modal/managerPaymentSchema");
const mongoose = require("mongoose");
const path = require("path");
const { getRelativePath } = require("../middleware/uploads"); // adjust path if needed
const fs = require("fs");
const User = require('../Modal/User')
const Tournament = require('../Modal/Tournament')
const Notification = require('../Modal/Notification')

exports.getQrCodes = async (req, res) => {
    try {
        const { managerId, tournamentId } = req.params;

        if (!managerId || !tournamentId) {
            return res.status(400).json({ message: "managerId and tournamentId are required" });
        }

        if (!mongoose.isValidObjectId(managerId)) {
            return res.status(400).json({ message: "Invalid managerId" });
        }

        const paymentSetup = await ManagerPayment.findOne({ managerId }).lean();

        if (!paymentSetup || !paymentSetup.qrCodes?.length) {
            return res.status(404).json({ message: "No QR codes found" });
        }

        let qrCodes = paymentSetup.qrCodes.map(qr => ({
            _id: qr._id,
            label: qr.label,
            imageUrl: qr.imageUrl, // full Cloudinary URL
        }));

        if (qrCodes.length > 1) {
            const randomIndex = Math.floor(Math.random() * qrCodes.length);
            qrCodes = [qrCodes[randomIndex]];
        }


        return res.status(200).json({
            manager: { _id: managerId },
            qrCodes,
        });
    } catch (error) {
        console.error("Error fetching QR codes:", error);
        return res.status(500).json({ message: "Server error", error: error.message });
    }
};

// ✅ Upload a QR Code image and save to ManagerPayment.qrCodes
exports.uploadQrCode = async (req, res) => {
    try {
        const { managerId, tournamentId } = req.params;
        const { label } = req.body || {};

        if (!managerId || !tournamentId) {
            return res.status(400).json({ message: "managerId and tournamentId are required" });
        }

        if (!mongoose.isValidObjectId(managerId)) {
            return res.status(400).json({ message: "Invalid managerId" });
        }

        if (!req.file) {
            return res.status(400).json({ message: "qrImage file is required" });
        }

        const absPath = req.file.path;
        // Normalize to always store starting with 'uploads/' (no leading slash)
        const relFromHelper = (getRelativePath(absPath) || "").replace(/\\/g, "/");
        const noLeadingSlash = relFromHelper.replace(/^\/+/, "");
        const storedUrl = noLeadingSlash.startsWith("uploads/")
            ? noLeadingSlash
            : `uploads/${noLeadingSlash.replace(/^uploads\//, "")}`;

        let paymentSetup = await ManagerPayment.findOne({ managerId, tournamentId });
        if (!paymentSetup) {
            paymentSetup = new ManagerPayment({ managerId, tournamentId });
        }

        paymentSetup.qrCodes.push({
            imageUrl: storedUrl,
            label: label || undefined,
            isActive: true,
            method: "online",
            status: "pending",
        });

        await paymentSetup.save();

        return res.status(201).json({
            message: "QR code uploaded successfully",
            qrCode: {
                imageUrl: storedUrl,
                label: label || null,
            },
        });
    } catch (error) {
        console.error("Error uploading QR code:", error);
        return res.status(500).json({ message: "Server error", error: error.message });
    }
};

// ✅ Get UPI IDs (return only one if multiple exist, chosen randomly)
exports.getUpiIds = async (req, res) => {
    try {
        const { managerId, tournamentId } = req.params;

        if (!managerId || !tournamentId) {
            return res.status(400).json({ message: "managerId and tournamentId are required" });
        }

        if (!mongoose.isValidObjectId(managerId)) {
            return res.status(400).json({ message: "Invalid managerId" });
        }

        const paymentSetup = await ManagerPayment.findOne({ managerId }).lean();
        if (!paymentSetup || !paymentSetup.upiIds?.length) {
            return res.status(404).json({ message: "No UPI IDs found" });
        }

        let upiIds = paymentSetup.upiIds

        if (!upiIds.length) {
            return res.status(404).json({ message: "No active UPI IDs found" });
        }

        if (upiIds.length > 1) {
            const randomIndex = Math.floor(Math.random() * upiIds.length);
            upiIds = [upiIds[randomIndex]];
        }

        return res.status(200).json({
            manager: { _id: managerId },
            upiIds,
        });
    } catch (error) {
        console.error("Error fetching UPI IDs:", error);
        return res.status(500).json({ message: "Server error", error: error.message });
    }
};

// ✅ Get Active Offline Payment Receivers
exports.getOfflinePayments = async (req, res) => {
    try {
        const { managerId, tournamentId } = req.params;

        if (!managerId || !tournamentId) {
            return res.status(400).json({ message: "managerId and tournamentId are required" });
        }

        if (!mongoose.isValidObjectId(managerId)) {
            return res.status(400).json({ message: "Invalid managerId" });
        }

        const paymentSetup = await ManagerPayment.findOne({ managerId }).lean();
        if (!paymentSetup || !paymentSetup.offlinePayments?.length) {
            return res.status(404).json({ message: "No offline payment receivers found" });
        }

        let activeOffline = paymentSetup.offlinePayments

        if (!activeOffline.length) {
            return res.status(404).json({ message: "No active offline payment receivers found" });
        }

        // Shuffle results and return only one if multiple exist
        if (activeOffline.length > 1) {
            const randomIndex = Math.floor(Math.random() * activeOffline.length);
            activeOffline = [activeOffline[randomIndex]];
        }

        return res.status(200).json({
            manager: { _id: managerId },
            offlinePayments: activeOffline,
        });
    } catch (error) {
        console.error("Error fetching offline payments:", error);
        return res.status(500).json({ message: "Server error", error: error.message });
    }
};

// ✅ Notify Manager that a user is ready to pay (offline/online)
exports.notifyManager = async (req, res) => {
    try {
        const { managerId, tournamentId } = req.params;

        const {
            userId,
            amount, // optional fallback
            registrationId,
            paymentMethod,
            selectedCategories = [],
        } = req.body;

        // -------------------------
        // Basic validations
        // -------------------------
        if (!managerId || !tournamentId) {
            return res.status(400).json({
                message: "managerId and tournamentId are required",
            });
        }

        if (!mongoose.isValidObjectId(managerId)) {
            return res.status(400).json({ message: "Invalid managerId" });
        }

        if (!paymentMethod) {
            return res.status(400).json({
                message: "paymentMethod is required (cash/online)",
            });
        }

        // -------------------------
        // Get payment setup
        // -------------------------
        const paymentSetup = await ManagerPayment.findOne({ managerId }).lean();
        if (!paymentSetup) {
            return res.status(404).json({
                message: "Manager payment setup not found",
            });
        }

        // -------------------------
        // Fetch user details
        // -------------------------
        const user = await User.findById(userId).lean();
        const userName = user?.name || "A player";

        // -------------------------
        // Fetch tournament details
        // -------------------------
        const tournament = await Tournament.findById(tournamentId).lean();
        const tournamentName = tournament?.title || "your tournament";

        const managerPhone =
            paymentSetup?.offlinePayments?.[0]?.receiverContact || null;

        // -------------------------
        // Helpers
        // -------------------------
        const formatINR = (value = 0) => `₹${Number(value)}`;

        // -------------------------
        // Calculate total payable amount
        // -------------------------
        let totalAmount = 0;

        if (Array.isArray(selectedCategories) && selectedCategories.length > 0) {
            totalAmount = selectedCategories.reduce((sum, cat) => {
                return sum + Number(cat.fee ?? 0);
            }, 0);
        } else {
            // fallback if categories not provided
            totalAmount = Number(amount ?? 0);
        }

        // -------------------------
        // Build notification message
        // -------------------------
        let notificationMsg;

        if (Array.isArray(selectedCategories) && selectedCategories.length > 0) {
            const categoryDetails = selectedCategories
                .map(cat => {
                    const name =
                        cat.name ||
                        cat.title ||
                        cat.categoryName ||
                        "Category";
                    const fee = formatINR(cat.fee ?? 0);
                    return `• ${name} (${fee})`;
                })
                .join("\n");

            notificationMsg =
                `This user ${userName} is ready to pay by ${paymentMethod} for the tournament "${tournamentName}".

Categories:
${categoryDetails}

Total Payable Amount: ${formatINR(totalAmount)}`;
        } else {
            notificationMsg =
                `This user ${userName} is ready to pay by ${paymentMethod} for the tournament "${tournamentName}".

Total Payable Amount: ${formatINR(totalAmount)}`;
        }

        // -------------------------
        // Prevent duplicate pending notifications
        // -------------------------
        const existingNotification = await Notification.findOne({
            managerId,
            tournamentId,
            userId,
            registrationId,
            transactionStatus: "pending",
        });

        if (existingNotification) {
            return res.status(200).json({
                success: true,
                message: "You already notified the manager, waiting for response",
                notification: existingNotification.message,
                notificationId: existingNotification._id,
            });
        }

        // -------------------------
        // Create notification
        // -------------------------
        const notification = await Notification.create({
            managerId,
            tournamentId,
            userId,
            registrationId,
            amount: totalAmount,
            paymentMethod,
            message: notificationMsg,
            transactionStatus: "pending",
        });

        // -------------------------
        // Response
        // -------------------------
        return res.status(201).json({
            success: true,
            message: "Manager notified successfully",
            phone: managerPhone,
            notification: notificationMsg,
            notificationId: notification._id,
        });
    } catch (error) {
        console.error("Error notifying manager:", error);
        return res.status(500).json({
            message: "Server error",
            error: error.message,
        });
    }
};

exports.getNotifications = async (req, res) => {
    try {
        const { managerId } = req.params;

        if (!managerId) {
            return res.status(400).json({ message: "managerId is required" });
        }

        const notifications = await Notification.find({ managerId })
            .sort({ createdAt: -1 }) // latest first
            .lean();

        return res.status(200).json({ success: true, notifications });
    } catch (error) {
        console.error("Error fetching notifications:", error);
        return res.status(500).json({ message: "Server error", error: error.message });
    }
};