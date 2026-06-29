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

        // The registration this proof pays for. Links the proof-review flow to
        // the Booking so that approving a proof can confirm the booking.
        // Optional: older records (and proofs submitted before a booking exists)
        // may not have it — verifyPayment falls back to (playerId, tournamentId).
        bookingId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Booking",
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
