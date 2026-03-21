const express = require("express");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");
const User = require("../Modal/User");

const router = express.Router();

// In-memory storage for OTPs
const otpStore = {};

// Function to generate a 6-digit OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000);

// Nodemailer transporter setup
const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: "bestowalsystems1@gmail.com",
    pass: "oitnmxsxhkrxgwkr",
  },
});

/* ==================== EMAIL VERIFICATION ==================== */
router.post("/send-otp", async (req, res) => {
  try {
    const { email } = req.body;
    const otp = generateOTP();

    // Store OTP in memory with an expiration time (5 minutes)
    otpStore[email] = { otp, expiresAt: Date.now() + 5 * 60 * 1000 };

    await transporter.sendMail({
      from: "bestowalsystems1@gmail.com",
      to: email,
      subject: "OTP Verification",
      text: `Your OTP code is: ${otp}`,
    });

    res.json({ message: "OTP sent successfully!" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    // Check if OTP exists and is valid
    if (!otpStore[email] || otpStore[email].otp !== parseInt(otp) || otpStore[email].expiresAt < Date.now()) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    // Delete OTP after successful verification
    delete otpStore[email];

    res.json({ message: "OTP verified successfully!" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});



/* ==================== FORGOT PASSWORD WITH OTP ==================== */
router.post("/forgot-password/send-otp", async (req, res) => {
  try {
    const { email } = req.body;

    // Check if user or manager exists
    const user = await User.findOne({ email });
    let manager = null;

    if (!user) {
      const { Manager } = require("../Modal/ClubManager");
      manager = await Manager.findOne({ email });
      if (!manager) {
        return res.status(404).json({ message: "User not found" });
      }
    }

    const otp = generateOTP();

    // Store OTP with expiration (5 minutes)
    otpStore[email] = { otp, expiresAt: Date.now() + 5 * 60 * 1000 };

    // Send OTP email
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Password Reset OTP",
      text: `Your OTP for password reset is: ${otp}. It is valid for 5 minutes.`,
    });

    res.json({ message: "OTP sent successfully!" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

/* ==================== VERIFY OTP ==================== */
router.post("/forgot-password/verify-otp", async (req, res) => {
  const { email, otp } = req.body;
  console.log("Verify Request:", { email, otp, store: otpStore[email] });

  if (!otpStore[email] || otpStore[email].otp !== parseInt(otp)) {
    return res.status(400).json({ message: "Invalid OTP" });
  }

  if (otpStore[email].expiresAt < Date.now()) {
    delete otpStore[email];
    return res.status(400).json({ message: "OTP expired" });
  }

  // Keep existing data and just update verified status
  otpStore[email] = {
    ...otpStore[email],
    verified: true
  };

  console.log("After verification:", otpStore[email]);
  res.json({ message: "OTP verified successfully!" });
});

router.post("/forgot-password/reset", async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    // Debug: Log incoming request data
    console.log("[Reset] Request Body:", req.body);
    console.log("[Reset] OTP Store for Email:", otpStore[email]);

    // Validate required fields
    if (!email || !newPassword) {
      console.error("[Reset] Missing fields:", { email, newPassword });
      return res.status(400).json({ message: "Email and new password are required" });
    }

    // Check OTP verification status
    if (
      !otpStore[email] ||
      !otpStore[email].verified ||
      otpStore[email].expiresAt < Date.now()
    ) {
      console.error("[Reset] OTP verification failed for email:", email);
      return res.status(400).json({ message: "OTP not verified or expired" });
    }

    // Update password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // An email can belong to multiple User roles (e.g. Player, Trainer)
    await User.updateMany({ email }, { password: hashedPassword });

    // Also update Manager or Superadmin if they share the same email
    const { Manager } = require("../Modal/ClubManager");
    if (Manager) {
      await Manager.updateMany({ email }, { password: hashedPassword });
    }

    delete otpStore[email]; // Clear OTP data
    res.json({ message: "Password reset successfully!" });
  } catch (error) {
    console.error("[Reset] Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});





module.exports = router;
