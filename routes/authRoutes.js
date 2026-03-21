const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../Modal/User");
const { Manager } = require("../Modal/ClubManager");
const DeviceToken = require("../Modal/DeviceToken");
const Superadminmodel = require("../Modal/Superadminmodel");
require("dotenv").config();
const router = express.Router();
const path = require("path");
const fs = require("fs");
const {
  uploadMiddleware,
  cleanupFile,
  uploadsDir,
  identityDocsDir,
} = require("../middleware/uploads");
const mongoose = require("mongoose");

// Register a new user
router.post("/register", async (req, res) => {
  const {
    name,
    email,
    mobile,
    password,
    role,
    age,
    website,
    members,
    clubName,
  } = req.body;

  try {
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: "User already exists" });
    }

    // For ClubAdmin role - check if club name already exists
    if (role === "ClubAdmin" && clubName) {
      const existingClub = await User.findOne({
        role: "ClubAdmin",
        clubName: clubName.trim(),
      });
      if (existingClub) {
        return res.status(400).json({ message: "Club name already exists" });
      }
    }

    user = new User({
      name,
      email,
      mobile,
      password,
      role,
      age,
      website,
      members,
      clubName: role === "ClubAdmin" ? clubName?.trim() : undefined,
      isApproved:
        role === "ClubAdmin" || role === "Organization" ? false : true,
    });

    await user.save();

    // For ClubAdmin, set clubId to their own _id (self-reference)
    if (role === "ClubAdmin") {
      user.clubId = user._id;
      await user.save();
    }

    if (user.isApproved) {
      const payload = { userId: user.id };
      jwt.sign(
        payload,
        process.env.JWT_SECRET,
        { expiresIn: "1h" },
        (err, token) => {
          if (err) throw err;
          res.json({ token, message: "Registration successful" });
        }
      );
    } else {
      res.json({ message: "Registration successful, waiting for approval" });
    }
  } catch (error) {
    console.error(error.message);
    res.status(500).send("Server error");
  }
});

// Login as User or Manager
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    const superadmin = await Superadminmodel.findOne({ email });
    const manager = await Manager.findOne({ email });

    // 🛑 Conflict Check
    const foundRoles = [user, superadmin, manager].filter(Boolean);
    if (foundRoles.length > 1) {
      return res.status(409).json({
        message:
          "Email exists for multiple roles. Please contact support or use a different account.",
      });
    }

    // ✅ Superadmin Login
    if (superadmin) {
      const match = await bcrypt.compare(password, superadmin.password);
      if (!match) return res.status(401).json({ message: "Invalid credentials" });

      const token = jwt.sign(
        { email, role: "superadmin" },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
      );
      return res.json({
        token,
        user: { email, role: "superadmin" },
      });
    }

    // ✅ Manager Login
    if (manager) {
      const isPasswordValid = await bcrypt.compare(password, manager.password);
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      if (!manager.isActive) {
        return res.status(403).json({ message: "Manager is not active" });
      }

      const token = jwt.sign(
        { id: manager._id, role: "Manager" },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
      );

      // Check if the parent club is a corporate admin
      const parentUser = await User.findById(manager.clubId);
      const isCorporate = parentUser && parentUser.role === "corporate_admin";

      return res.json({
        token,
        user: {
          id: manager._id,
          email: manager.email,
          name: manager.name,
          role: "Manager",
          clubId: manager.clubId || null,
          isCorporate: !!isCorporate,
        },
      });
    }

    // ✅ User/Admin Login
    if (user) {
      if (!user.isApproved) {
        return res.status(403).json({ message: "User not approved yet" });
      }

      const match = await bcrypt.compare(password, user.password);
      if (!match) return res.status(401).json({ message: "Invalid credentials" });

      const token = jwt.sign(
        { id: user._id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
      );
      return res.json({
        token,
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          role: user.role,
          clubName: user.clubName,
          clubId: user.clubId,
        },
      });
    }

    return res.status(404).json({ message: "User not found" });
  } catch (error) {
    console.error("Error logging in:", error);
    res.status(500).json({ message: "Error logging in", error });
  }
});

const otpStore = {};

// Forgot password reset (unified endpoint)
router.post("/forgot-password/reset", async (req, res) => {
  try {
    console.log("Received request body:", req.body); // Debug log

    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    if (
      !otpStore[email] ||
      otpStore[email].otp !== parseInt(otp) ||
      otpStore[email].expiresAt < Date.now()
    ) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.updateOne({ email }, { password: hashedPassword });
    delete otpStore[email];

    res.json({ message: "Password reset successful!" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// Legacy auth endpoint for backward compatibility
router.post("/forgot-password/reset/auth", async (req, res) => {
  try {
    console.log("Received request body:", req.body); // Debug log

    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    if (
      !otpStore[email] ||
      otpStore[email].otp !== parseInt(otp) ||
      otpStore[email].expiresAt < Date.now()
    ) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.updateOne({ email }, { password: hashedPassword });
    delete otpStore[email];

    res.json({ message: "Password reset successful!" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// Superadmin login
router.post("/superadminlogin", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await Superadminmodel.findOne({ email });
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (isMatch) {
      const token = jwt.sign({ email }, process.env.JWT_SECRET, {
        expiresIn: "1h",
      });
      return res.json({ success: true, token });
    } else {
      return res
        .status(401)
        .json({ success: false, message: "Invalid email or password" });
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Google Sign-In endpoint
router.post("/google-login", async (req, res) => {
  const { token, email, name, platform } = req.body;

  console.log("Processing Google login request for:", email);

  try {
    // Verify the access token by making a request to Google's userinfo endpoint
    const userInfoResponse = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!userInfoResponse.ok) {
      console.error("Failed to verify access token with Google");
      throw new Error("Invalid access token");
    }

    const googleUserInfo = await userInfoResponse.json();

    // Verify email is verified with Google
    if (!googleUserInfo.email_verified) {
      console.error("Email not verified with Google");
      return res.status(400).json({
        message: "Please verify your email with Google first",
      });
    }

    // Verify email matches
    if (googleUserInfo.email !== email) {
      console.error("Email mismatch detected");
      return res.status(400).json({
        message: "Authentication failed",
      });
    }

    // Find or create user
    let user = await User.findOne({
      $or: [{ email: googleUserInfo.email }, { googleId: googleUserInfo.sub }],
    });

    if (!user) {
      // Create new user with a simple random password
      const randomPassword =
        Math.random().toString(36) + Date.now().toString(36);

      user = new User({
        name: name || googleUserInfo.name,
        email: googleUserInfo.email,
        password: await bcrypt.hash(randomPassword, 10),
        isApproved: true,
        role: "Player",
        authProvider: "google",
        googleId: googleUserInfo.sub,
        emailVerified: true,
        profilePicture: googleUserInfo.picture || null,
        mobile: "pending",
        needsMobileUpdate: true,
      });

      try {
        await user.save();
        console.log("New user created successfully");
      } catch (saveError) {
        console.error("User creation failed:", saveError);
        return res.status(500).json({
          message: "Failed to create account",
          requiresMobile: true, // Indicate that mobile number is required
        });
      }
    } else {
      // Update existing user's Google info if needed
      if (!user.googleId || user.googleId !== googleUserInfo.sub) {
        user.googleId = googleUserInfo.sub;
        user.authProvider = "google";
        if (googleUserInfo.picture && !user.profilePicture) {
          user.profilePicture = googleUserInfo.picture;
        }
        await user.save();
      }
    }

    // Generate JWT
    const jwtToken = jwt.sign(
      {
        id: user._id,
        email: user.email,
        role: user.role,
        authProvider: "google",
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "1h",
        algorithm: "HS256",
      }
    );

    // Send response
    res.json({
      token: jwtToken,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        isApproved: user.isApproved,
        profilePicture: user.profilePicture,
        mobile: user.mobile,
        needsMobileUpdate: user.needsMobileUpdate || user.mobile === "pending",
      },
    });
  } catch (error) {
    console.error("Authentication failed:", {
      message: error.message,
      stack: error.stack,
    });
    res.status(401).json({
      message: "Authentication failed",
      error: process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
});

// Update user profile
router.put("/user/profile/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Fields that need to be updated
    const updateableFields = [
      "name",
      "dateOfBirth",
      "age",
      "sex",
      "sports",
      "clubNames",
      "mobile",
      "emergencyContact",
      "email",
      "address",
      "rank",
      "achievements",
      "identityType",
      "identityId",
      "locations",
      "referralCode",
      "bio",
      "certificates",
    ];

    // Create update object with only the fields that exist in the request
    const updateData = {};
    updateableFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        // Special handling for arrays (like certificates, sports, clubNames)
        if (Array.isArray(req.body[field])) {
          updateData[field] = req.body[field];
        }
        // Handle empty strings
        else if (req.body[field] === "") {
          updateData[field] = "";
        }
        // Handle other values
        else if (req.body[field] !== user[field]) {
          updateData[field] = req.body[field];
        }
      }
    });

    // If there are changes, update the user
    if (Object.keys(updateData).length > 0) {
      const updatedUser = await User.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true }
      );

      res.json({
        message: "Profile updated successfully",
        user: updatedUser,
      });
    } else {
      res.json({
        message: "No changes to update",
        user: user,
      });
    }
  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get user profile
router.get("/user/profile/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Format the response according to your existing schema
    const profileData = {
      playerId: user.playerId,
      name: user.name,
      dateOfBirth: user.dateOfBirth,
      age: user.age,
      sex: user.sex,
      sports: user.sports.length ? user.sports : ["table-tennis"], // Set default if empty
      clubNames: user.clubNames,
      mobile: user.mobile,
      emergencyContact: user.emergencyContact,
      email: user.email,
      address: user.address,
      rank: user.rank,
      achievements: user.achievements,
      identityType: user.identityType,
      identityId: user.identityId,
      locations: user.locations,
      referralCode: user.referralCode,
      profileImage: user.profileImage,
      certificates: user.certificates,
      bio: user.bio,
    };

    res.json(profileData);
  } catch (error) {
    console.error("Profile fetch error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Profile image upload route
router.post(
  "/user/profile/upload-image/:id",
  uploadMiddleware.single("profile-image"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const user = await User.findById(req.params.id);
      if (!user) {
        await cleanupFile(req.file.path);
        return res.status(404).json({ message: "User not found" });
      }

      // Delete old profile image if exists
      if (user.profileImage) {
        const oldImagePath = path.join(uploadsDir, user.profileImage);
        await cleanupFile(oldImagePath);
      }

      const relativePath = path
        .join("profiles", path.basename(req.file.path))
        .replace(/\\/g, "/");

      user.profileImage = relativePath;
      await user.save();

      res.json({
        message: "Profile image uploaded successfully",
        imageUrl: relativePath,
      });
    } catch (error) {
      if (req.file) await cleanupFile(req.file.path);
      res.status(500).json({ message: error.message });
    }
  }
);

// Error handling middleware
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        message: "File size cannot exceed 5MB",
      });
    }
    return res.status(400).json({
      message: "File upload error: " + err.message,
    });
  }

  res.status(500).json({
    message: err.message || "An unknown error occurred",
  });
});

// Certificate upload route
// router.post(
//   "/user/profile/upload-certificate/:id",
//   uploadMiddleware.single("certificate"),
//   async (req, res) => {
//     try {
//       if (!req.file) {
//         return res.status(400).json({ message: "No file uploaded" });
//       }

//       const user = await User.findById(req.params.id);
//       if (!user) {
//         await cleanupFile(req.file.path);
//         return res.status(404).json({ message: "User not found" });
//       }

//       const relativePath = path
//         .join("certificates", path.basename(req.file.path))
//         .replace(/\\/g, "/");

//       const certificateInfo = {
//         path: relativePath,
//         name: req.file.originalname,
//         type: req.file.mimetype,
//         uploadedAt: new Date(),
//       };

//       if (!user.certificates) {
//         user.certificates = [];
//       }

//       user.certificates.push(certificateInfo);
//       await user.save();

//       res.json({
//         message: "Certificate uploaded successfully",
//         certificate: certificateInfo,
//       });
//     } catch (error) {
//       if (req.file) await cleanupFile(req.file.path);
//       res.status(500).json({ message: error.message });
//     }
//   }
// );

// Certificate deletion route
router.delete(
  "/user/profile/certificate/:id/:certificateIndex",
  async (req, res) => {
    try {
      const user = await User.findById(req.params.id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const certificateIndex = parseInt(req.params.certificateIndex);
      if (
        certificateIndex < 0 ||
        certificateIndex >= user.certificates.length
      ) {
        return res.status(400).json({ message: "Invalid certificate index" });
      }

      // Get certificate before removing
      const certificate = user.certificates[certificateIndex];

      // Remove certificate from array
      user.certificates.splice(certificateIndex, 1);
      await user.save();

      // Delete file from storage
      if (certificate && certificate.path) {
        const fullPath = path.join(
          __dirname,
          "..",
          "uploads",
          certificate.path
        );
        await cleanupFile(fullPath);
      }

      res.json({ message: "Certificate deleted successfully" });
    } catch (error) {
      console.error("Certificate deletion error:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Certificate retrieval route
router.get("/certificates/:filename", (req, res) => {
  try {
    const filename = req.params.filename;
    const filepath = path.join(certificatesDir, filename);

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ message: "Certificate not found" });
    }

    const ext = path.extname(filename).toLowerCase();
    const contentType =
      {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
      }[ext] || "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

    const fileStream = fs.createReadStream(filepath);
    fileStream.pipe(res);
  } catch (error) {
    console.error("Certificate retrieval error:", error);
    res.status(500).json({ message: "Error retrieving certificate" });
  }
});

// Identity document upload route
// router.post(
//   "/user/identity/:id",
//   uploadMiddleware.single("identity-document"),
//   async (req, res) => {
//     try {
//       if (!req.file) {
//         return res.status(400).json({ message: "No file uploaded" });
//       }

//       const user = await User.findById(req.params.id);
//       if (!user) {
//         await cleanupFile(req.file.path);
//         return res.status(404).json({ message: "User not found" });
//       }

//       // Delete old identity document if exists
//       if (user.identityDocument && user.identityDocument.path) {
//         try {
//           const oldPath = path.join(uploadsDir, user.identityDocument.path);
//           await fs.promises.unlink(oldPath);
//         } catch (err) {
//           console.error("Error deleting old file:", err);
//           // Continue even if old file deletion fails
//         }
//       }

//       // Validate identity type and number
//       const { identityType, identityNumber } = req.body;
//       console.log("Received identity data:", { identityType, identityNumber }); // Debug log

//       const AADHAR_PATTERN = /^\d{12}$/;
//       const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

//       if (
//         identityType === "aadhar-card" &&
//         !AADHAR_PATTERN.test(identityNumber)
//       ) {
//         await cleanupFile(req.file.path);
//         return res
//           .status(400)
//           .json({ message: "Invalid Aadhar number format" });
//       }

//       if (
//         identityType === "pan-card" &&
//         !PAN_PATTERN.test(identityNumber.toUpperCase())
//       ) {
//         await cleanupFile(req.file.path);
//         return res.status(400).json({ message: "Invalid PAN number format" });
//       }

//       // Create relative path for the new file
//       const identityDocsPath = path.relative(uploadsDir, identityDocsDir);
//       const fileName = path.basename(req.file.path);
//       const relativePath = path
//         .join(identityDocsPath, fileName)
//         .replace(/\\/g, "/");

//       // Update user document
//       user.identityDocument = {
//         path: relativePath,
//         name: req.file.originalname,
//         type: req.file.mimetype,
//         uploadedAt: new Date(),
//       };

//       // Also update the identity type and number
//       user.identityType = identityType;
//       user.identityId =
//         identityType === "pan-card"
//           ? identityNumber.toUpperCase()
//           : identityNumber;

//       await user.save();

//       res.json({
//         message: "Identity document uploaded successfully",
//         document: user.identityDocument,
//       });
//     } catch (error) {
//       if (req.file) {
//         await cleanupFile(req.file.path);
//       }
//       console.error("Identity document upload error:", error);
//       res.status(500).json({ message: error.message });
//     }
//   }
// );

// Get identity document route
router.get("/user/identity/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || !user.identityDocument || !user.identityDocument.path) {
      return res.status(404).json({ message: "Identity document not found" });
    }

    const filePath = path.join(uploadsDir, user.identityDocument.path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "Document file not found" });
    }

    res.sendFile(filePath);
  } catch (error) {
    console.error("Identity document retrieval error:", error);
    res.status(500).json({ message: "Error retrieving identity document" });
  }
});

// Device token management endpoints

// check-token endpoint
router.post("/check-token", async (req, res) => {
  try {
    const { userId, token } = req.body;

    if (!userId || !token) {
      return res.status(400).json({
        success: false,
        message: "User ID and token are required",
      });
    }

    const objectId = mongoose.Types.ObjectId.createFromHexString(userId);

    // Check for an active token for this user and token combination
    const existingToken = await DeviceToken.findOne({
      userId: objectId,
      token: token,
      isActive: true,
    });

    res.json({
      exists: !!existingToken,
      isActive: existingToken?.isActive || false,
    });
  } catch (error) {
    console.error("[TOKEN_CHECK] Error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// register-device endpoint
router.post("/register-device", async (req, res) => {
  try {
    console.log("[DEVICE_REGISTER] Received request:", req.body);
    const { userId, token, allowNotifications } = req.body;

    if (!userId || !token) {
      return res.status(400).json({
        success: false,
        message: "User ID and token are required",
      });
    }

    const objectId = mongoose.Types.ObjectId.createFromHexString(userId);

    // Find if this user already has any tokens
    const userExistingTokens = await DeviceToken.findOne({ userId: objectId });

    // If this token is already assigned to another user, reject it
    const tokenAssignedToOther = await DeviceToken.findOne({
      token: token,
      userId: { $ne: objectId },
    });

    if (tokenAssignedToOther) {
      return res.status(400).json({
        success: false,
        message: "Please generate a new token for this user",
        requireNewToken: true,
      });
    }

    // Deactivate any existing tokens for this user
    await DeviceToken.updateMany(
      { userId: objectId },
      {
        isActive: false,
        lastUpdated: new Date(),
      }
    );

    // Create new token for this user
    const deviceToken = new DeviceToken({
      userId: objectId,
      token,
      allowNotifications,
      isActive: true,
      lastUpdated: new Date(),
    });

    await deviceToken.save();
    console.log("[DEVICE_REGISTER] Created new token for user:", userId);

    res.json({
      success: true,
      message: "Device registered successfully",
      tokenId: deviceToken._id,
    });
  } catch (error) {
    console.error("[DEVICE_REGISTER] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to register device",
      error: error.message,
    });
  }
});

// Check device token endpoint
router.get("/check-device-token/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const objectId = mongoose.Types.ObjectId.createFromHexString(userId);

    const existingToken = await DeviceToken.findOne({
      userId: objectId,
      isActive: true,
    });

    res.json({
      hasToken: !!existingToken,
      tokenId: existingToken?._id,
    });
  } catch (error) {
    console.error("[TOKEN_CHECK] Error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Deregister device endpoint
router.post("/deregister-device", async (req, res) => {
  const { userId, token } = req.body;

  try {
    // Find and deactivate the token
    await DeviceToken.updateOne(
      { userId, token, isActive: true },
      { isActive: false, lastUpdated: new Date() }
    );

    res.status(200).send({ success: true });
  } catch (error) {
    console.error("[DEREGISTER_DEVICE] Error:", error);
    res
      .status(500)
      .send({ success: false, error: "Failed to deregister token" });
  }
});

// Get current authenticated user
router.get("/user/me", async (req, res) => {
  try {
    const authHeader = req.header("Authorization");
    if (!authHeader) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = authHeader.replace("Bearer ", "");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (error) {
    console.error("Error fetching current user:", error);
    res.status(401).json({ message: "Invalid token" });
  }
});

// Check if user can switch role (Player <-> Trainer)
router.get("/user/can-switch-role/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ canSwitch: false, message: "User not found" });
    }

    // Allow switch if user role is Player or Trainer
    const canSwitch = user.role === "Player" || user.role === "Trainer";
    res.json({ canSwitch });
  } catch (error) {
    console.error("Error checking role switch:", error);
    res.status(500).json({ canSwitch: false, message: error.message });
  }
});

// Switch user role (Player <-> Trainer)
router.post("/user/switch-role/:userId", async (req, res) => {
  try {
    const authHeader = req.header("Authorization");
    if (!authHeader) {
      return res.status(401).json({ success: false, message: "No token provided" });
    }

    const token = authHeader.replace("Bearer ", "");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.id !== req.params.userId) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const newRole = user.role === "Player" ? "Trainer" : "Player";
    user.role = newRole;
    await user.save();

    // Generate new token with updated role
    const newToken = jwt.sign(
      { id: user._id, email: user.email, role: newRole },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      success: true,
      message: `Switched to ${newRole} mode`,
      token: newToken,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: newRole,
        profileImage: user.profileImage,
      },
    });
  } catch (error) {
    console.error("Error switching role:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;