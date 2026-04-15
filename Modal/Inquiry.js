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
            enum: ["Product", "Service", "Partnership", "Register Club", "Other"],
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
        status: {
            type: String,
            default: "Pending",
            enum: ["Pending", "Reviewed", "Resolved"],
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("Inquiry", InquirySchema);
