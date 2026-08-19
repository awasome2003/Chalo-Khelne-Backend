const mongoose = require("mongoose");

const InquirySchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
        },
        email: {
            type: String,
            required: true,
        },
        phone: {
            type: String,
            required: true,
        },
        inquiryType: {
            type: String,
            required: true,
            // "Tournament" is the /for-organizers form. Kept as its own type so
            // organizer leads can be filtered out of the general inbox — any
            // admin UI that lists types by hand needs it adding there too.
            enum: ["Product", "Service", "Partnership", "Register Club", "Tournament", "Other"],
        },
        message: {
            type: String,
        },
        clubName: {
            type: String,
        },
        city: {
            type: String,
        },
        sports: {
            type: String,
        },
        // ── Tournament-organizer qualification ────────────────────────────
        // The date is the single most useful field on the form: an organizer
        // with an event five weeks out is a live deal, one with no date is a
        // newsletter subscriber. Sorting the inbox by it turns a pile of
        // messages into a pipeline. Optional, so the general form is unaffected.
        eventDate: {
            type: Date,
        },
        expectedEntries: {
            type: Number,
            min: 0,
        },
        status: {
            type: String,
            default: "Pending",
            enum: ["Pending", "Reviewed", "Resolved"],
        },
    },
    { timestamps: true }
);


// ── Indexes (§7.3 — this model declared none) ──────────────────────────
// the inquiry list sorts newest-first
InquirySchema.index({ createdAt: -1 });

module.exports = mongoose.model("Inquiry", InquirySchema);
