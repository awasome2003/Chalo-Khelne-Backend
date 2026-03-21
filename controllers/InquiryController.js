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
        const { name, email, phone, inquiryType, message } = req.body;

        if (!name || !email || !phone || !inquiryType) {
            return res.status(400).json({ message: "All required fields must be provided." });
        }

        const newInquiry = new Inquiry({
            name,
            email,
            phone,
            inquiryType,
            message,
        });

        await newInquiry.save();

        // Optional: Send email notification to Admin (Superadmin)
        // const mailOptions = {
        //   from: process.env.EMAIL_USER,
        //   to: "admin_email@example.com", 
        //   subject: "New Inquiry Received",
        //   text: `You have a new inquiry from ${name}.\nType: ${inquiryType}\nMessage: ${message}`,
        // };
        // transporter.sendMail(mailOptions);

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
