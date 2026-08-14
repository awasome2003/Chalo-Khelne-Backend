const Inquiry = require("../src/modules/commerce/models/Inquiry");
const nodemailer = require("nodemailer");

// Non-breaking server-side pagination + search (activates only on ?page/?limit).
const { parsePaging, pageMeta, searchFilter } = require("../utils/paginate");

// Configure Nodemailer (Reusing existing config or env vars is better practice)
const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

exports.createInquiry = async (req, res) => {
    try {
        const { name, email, phone, inquiryType, message, clubName, city, sports } = req.body;

        if (!name || !email || !phone || !inquiryType) {
            return res.status(400).json({ message: "All required fields must be provided." });
        }

        const newInquiry = new Inquiry({
            name,
            email,
            phone,
            inquiryType,
            message,
            clubName,
            city,
            sports,
        });

        await newInquiry.save();

        // Send email notification to User
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: email, 
          subject: "Inquiry Received - ChaloKhelne",
          text: `Hi ${name},\n\nWe have received your inquiry regarding "${inquiryType}". Our team will review your request and get back to you shortly.\n\nBest Regards,\nChaloKhelne Team`,
        };
        transporter.sendMail(mailOptions, (error, info) => {
            if (error) console.error("Error sending user confirmation email:", error);
        });

        res.status(201).json({ message: "Inquiry submitted successfully", inquiry: newInquiry });
    } catch (error) {
        console.error("Error creating inquiry:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

exports.getAllInquiries = async (req, res) => {
    try {
        const filter = { ...searchFilter(req, ["name", "email", "phone", "message", "clubName"]) };
        const { paged, page, limit, skip } = parsePaging(req);
        if (!paged) {
            // Legacy shape: bare array (frozen mobile app / other callers).
            const inquiries = await Inquiry.find(filter).sort({ createdAt: -1 });
            return res.json(inquiries);
        }
        const [items, total] = await Promise.all([
            Inquiry.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
            Inquiry.countDocuments(filter),
        ]);
        return res.json({ items, ...pageMeta(total, page, limit) });
    } catch (error) {
        console.error("Error fetching inquiries:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

exports.updateInquiryStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const updatedInquiry = await Inquiry.findByIdAndUpdate(
            id,
            { status },
            { new: true }
        );

        if (!updatedInquiry) {
            return res.status(404).json({ message: "Inquiry not found" });
        }

        res.json({ message: "Inquiry status updated", inquiry: updatedInquiry });
    } catch (error) {
        console.error("Error updating inquiry status:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
};
