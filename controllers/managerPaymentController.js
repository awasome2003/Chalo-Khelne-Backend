const ManagerPayment = require("../Modal/managerPaymentSchema");
const Notification = require("../Modal/Notification");
const User = require('../Modal/User');
const path = require("path");
const fs = require("fs");

/* =========================================================
   1️⃣ CREATE OR UPDATE PAYMENT SETUP
   ========================================================= */
exports.upsertPaymentSetup = async (req, res) => {
    try {
        const { managerId, tournamentId } = req.body;

        if (!managerId) {
            return res.status(400).json({
                success: false,
                message: "Manager ID is required"
            });
        }

        // Map uploaded QR codes (if any)
        const qrCodes = (req.files || []).map(file => ({
            imageUrl: path.relative(process.cwd(), file.path).replace(/\\/g, "/"),
            public_id: file.filename,
            label: req.body.label || "",
            isActive: true,
            method: "online",
            status: "pending",
        }));

        // Parse UPI IDs safely
        let parsedUpis = [];
        try {
            if (req.body.upiIds) {
                parsedUpis = Array.isArray(req.body.upiIds) ? req.body.upiIds : JSON.parse(req.body.upiIds);
            }
        } catch (e) {
            parsedUpis = [];
        }

        // Parse offline payments safely
        let parsedOffline = [];
        try {
            if (req.body.offlinePayments) {
                parsedOffline = Array.isArray(req.body.offlinePayments) ? req.body.offlinePayments : JSON.parse(req.body.offlinePayments);
            }
        } catch (e) {
            parsedOffline = [];
        }

        // Check if setup exists
        let paymentSetup = await ManagerPayment.findOne({ managerId, tournamentId });

        if (paymentSetup) {
            console.log("✓ Updating existing payment setup");

            if (parsedUpis.length) {
                paymentSetup.upiIds.push(
                    ...parsedUpis.map(u => ({
                        upi: u,
                        label: "",
                        isActive: true,
                        method: "online",
                        status: "pending",
                    }))
                );
            }

            if (qrCodes.length) paymentSetup.qrCodes.push(...qrCodes);

            if (parsedOffline.length) {
                paymentSetup.offlinePayments.push(
                    ...parsedOffline.map(o => ({
                        receiverName: o.receiverName,
                        receiverContact: o.receiverContact,
                        label: o.label || "",
                        isActive: true,
                        method: "offline",
                        status: "pending",
                    }))
                );
            }

            await paymentSetup.save();
            console.log("✓ Payment setup updated");
        } else {
            console.log("✓ Creating new payment setup");

            paymentSetup = new ManagerPayment({
                managerId,
                tournamentId,
                upiIds: parsedUpis.map(u => ({
                    upi: u,
                    label: "",
                    isActive: true,
                    method: "online",
                    status: "pending",
                })),
                qrCodes,
                offlinePayments: parsedOffline.map(o => ({
                    receiverName: o.receiverName,
                    receiverContact: o.receiverContact,
                    label: o.label || "",
                    isActive: true,
                    method: "offline",
                    status: "pending",
                })),
            });

            await paymentSetup.save();
            console.log("✓ Payment setup created");
        }

        res.status(200).json({
            success: true,
            message: "Payment setup saved successfully",
            data: paymentSetup,
        });

    } catch (error) {
        console.error("=== ERROR ===", error);
        res.status(500).json({
            success: false,
            message: "Server Error",
            error: error.message,
            details: process.env.NODE_ENV === "development" ? error.stack : undefined
        });
    }
};


/* =========================================================
   2️⃣ GET PAYMENT SETUP
   ========================================================= */
exports.getPaymentSetup = async (req, res) => {
    try {
        const { managerId, tournamentId } = req.params;
        const query = { managerId };
        if (tournamentId) query.tournamentId = tournamentId;

        const setup = await ManagerPayment.findOne(query);
        if (!setup) {
            return res.status(404).json({ success: false, message: "Payment setup not found" });
        }

        res.status(200).json({ success: true, data: setup });
    } catch (error) {
        console.error("Error in getPaymentSetup:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

/* =========================================================
   3️⃣ DELETE PAYMENT OPTION
   ========================================================= */
exports.deletePaymentOption = async (req, res) => {
    try {
        const { managerId, optionId, type } = req.body;
        const setup = await ManagerPayment.findOne({ managerId });
        if (!setup) return res.status(404).json({ success: false, message: "Payment setup not found" });

        if (type === "upi") {
            setup.upiIds = setup.upiIds.filter(upi => upi._id.toString() !== optionId);
        } else if (type === "qr") {
            // 🔹 Find the QR being deleted
            const qrToDelete = setup.qrCodes.find(qr => qr._id.toString() === optionId);

            if (qrToDelete) {
                // ✅ Remove file from local storage
                if (qrToDelete.imageUrl) {
                    const filePath = path.join(process.cwd(), qrToDelete.imageUrl);
                    if (fs.existsSync(filePath)) {
                        fs.unlink(filePath, (err) => {
                            if (err) {
                                console.error("⚠️ Failed to delete local QR file:", err.message);
                            } else {
                                console.log("✅ Deleted local QR file:", filePath);
                            }
                        });
                    }
                }                // ✅ Remove from DB
                setup.qrCodes = setup.qrCodes.filter(qr => qr._id.toString() !== optionId);
            }
        } else if (type === "offline") {
            setup.offlinePayments = setup.offlinePayments.filter(o => o._id.toString() !== optionId);
        } else {
            return res.status(400).json({ success: false, message: "Invalid type" });
        }

        await setup.save();
        res.status(200).json({ success: true, message: `${type.toUpperCase()} option removed successfully`, data: setup });
    } catch (error) {
        console.error("Error in deletePaymentOption:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

/* =========================================================
   4️⃣ UPDATE PAYMENT OPTION
   ========================================================= */
exports.updatePaymentOption = async (req, res) => {
    try {
        const { managerId, optionId, type, updates } = req.body;
        const setup = await ManagerPayment.findOne({ managerId });
        if (!setup) return res.status(404).json({ success: false, message: "Payment setup not found" });

        let optionArray;
        if (type === "upi") optionArray = setup.upiIds;
        else if (type === "qr") optionArray = setup.qrCodes;
        else if (type === "offline") optionArray = setup.offlinePayments;
        else return res.status(400).json({ success: false, message: "Invalid type" });

        const option = optionArray.id(optionId);
        if (!option) return res.status(404).json({ success: false, message: "Payment option not found" });

        Object.keys(updates).forEach(key => option[key] = updates[key]);
        await setup.save();

        res.status(200).json({ success: true, message: `${type.toUpperCase()} option updated successfully`, data: setup });
    } catch (error) {
        console.error("Error in updatePaymentOption:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

/* =========================================================
   5️⃣ FETCH QR / UPI / OFFLINE
   ========================================================= */
exports.getQrCodes = async (req, res) => {
    try {
        const { managerId, tournamentId } = req.params;

        // Try with tournamentId first, then fallback to manager-only
        let setup = null;
        if (tournamentId) {
            setup = await ManagerPayment.findOne({ managerId, tournamentId }).lean();
        }
        if (!setup) {
            setup = await ManagerPayment.findOne({ managerId }).lean();
        }
        if (!setup || !setup.qrCodes?.length) return res.status(404).json({ message: "No QR codes found" });

        const activeQrCodes = setup.qrCodes.filter(qr => qr.isActive);
        return res.status(200).json({ qrCodes: activeQrCodes });
    } catch (error) {
        console.error("Error fetching QR codes:", error);
        return res.status(500).json({ message: "Server error", error: error.message });
    }
};

exports.getUpiIds = async (req, res) => {
    try {
        const { managerId, tournamentId } = req.params;

        let setup = null;
        if (tournamentId) {
            setup = await ManagerPayment.findOne({ managerId, tournamentId }).lean();
        }
        if (!setup) {
            setup = await ManagerPayment.findOne({ managerId }).lean();
        }
        if (!setup || !setup.upiIds?.length) return res.status(404).json({ message: "No UPI IDs found" });

        const activeUpiIds = setup.upiIds.filter(upi => upi.isActive);
        return res.status(200).json({ upiIds: activeUpiIds });
    } catch (error) {
        console.error("Error fetching UPI IDs:", error);
        return res.status(500).json({ message: "Server error", error: error.message });
    }
};

exports.getOfflinePayments = async (req, res) => {
    try {
        const { managerId, tournamentId } = req.params;

        let setup = null;
        if (tournamentId) {
            setup = await ManagerPayment.findOne({ managerId, tournamentId }).lean();
        }
        if (!setup) {
            setup = await ManagerPayment.findOne({ managerId }).lean();
        }
        if (!setup || !setup.offlinePayments?.length) return res.status(404).json({ message: "No offline payments found" });

        const activeOffline = setup.offlinePayments.filter(off => off.isActive);
        return res.status(200).json({ offlinePayments: activeOffline });
    } catch (error) {
        console.error("Error fetching offline payments:", error);
        return res.status(500).json({ message: "Server error", error: error.message });
    }
};

/* =========================================================
   6️⃣ FETCH MANAGER NOTIFICATIONS
   ========================================================= */
exports.getNotificationsForManager = async (req, res) => {
    try {
        const { managerId } = req.params;
        const notifications = await Notification.find({ managerId })
            .sort({ createdAt: -1 })
            .populate({
                path: "userId",
                select: "_id name email mobile gender dob image role sports win lose draw",
            });

        res.json({ success: true, notifications });
    } catch (error) {
        console.error("Error fetching notifications:", error);
        res.status(500).json({ success: false, message: "Failed to fetch notifications" });
    }
};
