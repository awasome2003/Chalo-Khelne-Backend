const mongoose = require("mongoose");

const HrContactSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    designation: {
        type: String,
        required: true,
    },
    contactNumber: {
        type: String,
        required: true,
    },
    email: {
        type: String,
        required: true,
    },
});

const CorporateClubAdminSchema = new mongoose.Schema(
    {
        companyName: {
            type: String,
            required: true,
        },
        industryType: {
            type: String,
            required: true,
        },
        companySize: {
            type: String,
            required: true,
        },
        location: {
            type: String,
            required: true,
        },
        hrContact: {
            type: HrContactSchema,
            required: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
    },
    { timestamps: true }
);


// ── Indexes (§7.3 — this model declared none) ──────────────────────────
// corporate admin lookup
HrContactSchema.index({ email: 1 });

module.exports = mongoose.model("CorporateClubAdmin", CorporateClubAdminSchema);
