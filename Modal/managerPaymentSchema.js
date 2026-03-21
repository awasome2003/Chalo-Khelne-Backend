const mongoose = require("mongoose");

const managerPaymentSchema = new mongoose.Schema(
    {
        managerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Manager",
            required: true,
        },
        tournamentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Tournament",
            required: false, // optional: tournament-specific setup
        },

        // 🔹 QR Code options (Cloudinary integrated)
        qrCodes: [
            {
                imageUrl: { type: String, required: true }, // Cloudinary secure_url
                public_id: { type: String, required: true }, // Cloudinary public_id (for deleting later)
                label: { type: String }, // e.g., "Google Pay", "PhonePe"
                isActive: { type: Boolean, default: true },
                method: { type: String, enum: ["online"], default: "online" },
                status: {
                    type: String,
                    enum: ["pending", "confirmed", "rejected"],
                    default: "pending",
                },
            },
        ],

        // 🔹 UPI ID options
        upiIds: [
            {
                upi: { type: String, required: true },
                label: { type: String },
                isActive: { type: Boolean, default: true },
                method: { type: String, enum: ["online"], default: "online" },
                status: {
                    type: String,
                    enum: ["pending", "confirmed", "rejected"],
                    default: "pending",
                },
            },
        ],

        // 🔹 Offline (Cash Payment) option
        offlinePayments: [
            {
                receiverName: { type: String, required: true },
                receiverContact: { type: String, required: true },
                label: { type: String },
                isActive: { type: Boolean, default: true },
                method: { type: String, enum: ["offline"], default: "offline" },
                status: {
                    type: String,
                    enum: ["pending", "confirmed", "rejected"],
                    default: "pending",
                },
            },
        ],

        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now },
    },
    { timestamps: true }
);

module.exports = mongoose.model("ManagerPayment", managerPaymentSchema);
