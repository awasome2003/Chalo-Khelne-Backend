const Inquiry = require("../Modal/Inquiry");
const nodemailer = require("nodemailer");

// Configure Nodemailer (Reusing existing config or env vars is better practice)
const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
        user: "notmumbai@gmail.com", // Should ideally be in env vars
        pass: "djbz wrcn uwtt woob",   // Should ideally be in env vars
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
          from: "notmumbai@gmail.com",
          to: email, 
          subject: "Inquiry Received - ChaloKhelne",
          text: `Hi ${name},\n\We have received your inquiry regarding "${inquiryType}". Our team will review your request and get back to you shortly.\n\nBest Regards,\nChaloKhelne Team`,
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
        const inquiries = await Inquiry.find().sort({ createdAt: -1 });
        res.json(inquiries);
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
