const mongoose = require("mongoose");

const playerPaymentSchema = new mongoose.Schema(
    {
        playerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        managerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        tournamentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Tournament",
            required: true,
        },

        // Which method was used
        paymentMethod: {
            type: String,
            enum: ["qr", "upi", "offline"],
            required: true,
        },

        // Reference to specific manager payment option
        managerPaymentOptionId: {
            type: mongoose.Schema.Types.ObjectId,
        },

        // If UPI: store txn ref
        transactionId: {
            type: String,
            required: true,
        },

        // If QR/UPI: store screenshot
        screenshot: {
            type: String,
        },

        // If Offline: store receiver info
        offlineReceiver: {
            name: { type: String },
            contact: { type: String },
        },

        status: {
            type: String,
            enum: ["pending", "approved", "rejected"],
            default: "pending",
        },

        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        updatedAt: {
            type: Date,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("PlayerPayment", playerPaymentSchema);
