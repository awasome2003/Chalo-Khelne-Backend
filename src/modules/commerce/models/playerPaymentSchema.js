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
            trim: true,
        },

        // The amount this proof is evidence for.
        //
        // §7.4: the proof-review document — the artefact a manager approves
        // money against — carried no monetary value at all. There was nothing to
        // reconcile the screenshot with: the manager saw a name and an image and
        // approved a payment of unknown size.
        //
        // ALWAYS derived server-side from the linked Booking at submission time
        // (uploadPaymentProof), never accepted from the client.
        amount: {
            type: Number,
            required: true,
            min: 0,
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

// ── Indexes (§7.3 — this model declared none) ────────────────────────────────
// The manager's proof-review inbox queries (managerId, status) and sorts by
// createdAt. Without this it was a collection scan on every dashboard poll.
playerPaymentSchema.index({ managerId: 1, status: 1, createdAt: -1 });
playerPaymentSchema.index({ playerId: 1, createdAt: -1 });
playerPaymentSchema.index({ tournamentId: 1, status: 1 });
playerPaymentSchema.index({ bookingId: 1 });

// One UPI reference backs one proof (§7.4).
//
// transactionId was `required` but carried no uniqueness constraint, so the
// same reference could back an unlimited number of proofs across different
// tournaments — only a manager's memory prevented one payment being submitted
// several times. Rejected proofs are excluded from the constraint so a player
// can correct and re-submit a genuinely mistyped reference.
playerPaymentSchema.index(
    { transactionId: 1 },
    {
        unique: true,
        partialFilterExpression: { status: { $in: ["pending", "approved"] } },
    }
);

module.exports = mongoose.model("PlayerPayment", playerPaymentSchema);
