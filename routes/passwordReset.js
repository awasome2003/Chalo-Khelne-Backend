// routes/passwordResetRoutes.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const User = require("../Modal/User");
const bcrypt = require("bcryptjs");
const path = require("path");

// Configure email transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

// GET route to handle reset password page
router.get("/reset-password/:token", (req, res) => {
  // Send the reset password HTML page
  res.sendFile(path.join(__dirname, "../public/reset-password.html"));
});

router.get("/reset-password-success", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/reset-success.html"));
});

// Initiate password reset
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      console.log(
        `Password reset rejected: No account found for email ${email}`
      );
      return res.status(400).json({
        success: false,
        message: "No account found with this email address",
      });
    }

    console.log(`Password reset initiated for user: ${user._id} (${email})`);

    const resetToken = jwt.sign(
      {
        userId: user._id,
        email: user.email, // Include email for additional validation
        timestamp: Date.now(),
      },
      process.env.JWT_RESET_SECRET,
      { expiresIn: "1h" }
    );

    // Create actual reset URL
    const resetUrl = `${process.env.FRONTEND_URL}/api/reset-password/${resetToken}`;

    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: email,
      subject: "Password Reset Request",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #1a73e8;">Password Reset Request</h2>
          <div style="margin: 30px 0; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <p>You requested to reset your password. Click the button below to reset your password:</p>
            <a href="${resetUrl}" 
               style="display: inline-block; 
                      background-color: #1a73e8; 
                      color: white; 
                      padding: 12px 24px; 
                      text-decoration: none; 
                      border-radius: 4px; 
                      margin: 20px 0;">
              Reset Password
            </a>
            <p style="margin-top: 20px;">If the button doesn't work, copy and paste this link into your browser:</p>
            <p style="background: #f5f5f5; padding: 15px; border-radius: 4px; font-family: monospace; word-break: break-all;">
              ${resetUrl}
            </p>
          </div>
          <p><strong>Note:</strong> This reset link will expire in 1 hour.</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({
      success: true,
      message: "Reset link has been sent to your email",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({
      success: false,
      message: "Error processing your request. Please try again later.",
    });
  }
});

// Reset password
router.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    // Verify the token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_RESET_SECRET);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset token.",
      });
    }

    // Find the user based on the token's userId
    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    // Check if the new password matches the old one
    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: "New password cannot be the same as your current password.",
      });
    }

    // Hash the new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update the user's password
    await User.updateOne(
      { _id: user._id },
      {
        $set: { password: hashedPassword },
      }
    );

    res.status(200).json({
      success: true,
      message: "Password has been reset successfully.",
    });
  } catch (error) {
    console.error("Error in /reset-password:", error);
    res.status(500).json({
      success: false,
      message: "Error resetting password. Please try again.",
    });
  }
});

module.exports = router;
