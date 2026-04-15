const express = require("express");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");
const User = require("../Modal/User");

const router = express.Router();

// In-memory storage for OTPs
const otpStore = {};

// Rate limiting for OTP requests (per email)
const otpRateLimit = {};
const OTP_COOLDOWN_MS = 60 * 1000; // 60 seconds between resends

// Function to generate a 6-digit OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000);

const EMAIL_FROM = process.env.EMAIL_USER || "bestowalsystems1@gmail.com";

// Nodemailer transporter setup
const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: process.env.EMAIL_USER || "bestowalsystems1@gmail.com",
    pass: process.env.EMAIL_PASS || "oitnmxsxhkrxgwkr",
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
      from: EMAIL_FROM,
      to: email,
      subject: "OTP Verification",
      text: `Your OTP code is: ${otp}`,
    });

    res.json({ message: "OTP sent successfully!" });
  } catch (error) {
    console.error("Email verification send-otp error:", error.message);
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

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // Rate limiting — 60s cooldown per email
    const lastSent = otpRateLimit[email];
    if (lastSent && Date.now() - lastSent < OTP_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((OTP_COOLDOWN_MS - (Date.now() - lastSent)) / 1000);
      return res.status(429).json({
        message: `Please wait ${waitSeconds} seconds before requesting a new code`,
        retryAfter: waitSeconds,
      });
    }

    // Check if user or manager exists
    const user = await User.findOne({ email });
    let manager = null;

    if (!user) {
      const { Manager } = require("../Modal/ClubManager");
      manager = await Manager.findOne({ email });
      if (!manager) {
        return res.status(404).json({ message: "No account found with this email address" });
      }
    }

    const otp = generateOTP();

    // Store OTP with expiration (5 minutes)
    otpStore[email] = { otp, expiresAt: Date.now() + 5 * 60 * 1000 };
    otpRateLimit[email] = Date.now();

    // Send OTP email
    await transporter.sendMail({
      from: EMAIL_FROM,
      to: email,
      subject: "Password Reset Code",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">Password Reset</h2>
          <p>Your password reset code is:</p>
          <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #FF6A00;">${otp}</span>
          </div>
          <p style="color: #666; font-size: 14px;">This code expires in <strong>5 minutes</strong>. If you didn't request this, please ignore this email.</p>
        </div>
      `,
    });

    res.json({ message: "OTP sent successfully!", expiresIn: 300 });
  } catch (error) {
    console.error("Forgot password send-otp error:", error.message);
    res.status(500).json({ message: "Failed to send reset code. Please try again." });
  }
});

/* ==================== VERIFY OTP ==================== */
router.post("/forgot-password/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  if (!otpStore[email]) {
    return res.status(400).json({ message: "No reset code found. Please request a new one." });
  }

  // Check expiry FIRST — give the correct error message
  if (otpStore[email].expiresAt < Date.now()) {
    delete otpStore[email];
    return res.status(400).json({ message: "Reset code has expired. Please request a new one." });
  }

  if (otpStore[email].otp !== parseInt(otp)) {
    return res.status(400).json({ message: "Incorrect code. Please check and try again." });
  }

  // Mark as verified
  otpStore[email] = {
    ...otpStore[email],
    verified: true,
  };

  res.json({ message: "OTP verified successfully!" });
});

router.post("/forgot-password/reset", async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    // Validate required fields
    if (!email || !newPassword) {
      return res.status(400).json({ message: "Email and new password are required" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    // Check OTP verification status
    if (!otpStore[email] || !otpStore[email].verified) {
      return res.status(400).json({ message: "Please verify your reset code first" });
    }

    if (otpStore[email].expiresAt < Date.now()) {
      delete otpStore[email];
      return res.status(400).json({ message: "Session expired. Please request a new reset code." });
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

    delete otpStore[email];
    delete otpRateLimit[email];
    res.json({ message: "Password reset successfully!" });
  } catch (error) {
    console.error("Password reset error:", error.message);
    res.status(500).json({ message: "Failed to reset password. Please try again." });
  }
});





module.exports = router;
