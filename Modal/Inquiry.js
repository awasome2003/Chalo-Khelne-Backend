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
            enum: ["Product", "Service", "Partnership", "Other"], // Adjust enums as needed or remove enum for flexibility
        },
        message: {
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
