const CorporateClubAdmin = require("../Modal/CorporateClubAdmin");
const User = require("../Modal/User");
const bcrypt = require("bcryptjs");
const { Manager } = require("../Modal/ClubManager");
const nodemailer = require("nodemailer");

// Create a Nodemailer transporter (Reusing config is better, but declaring here for now)
const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
        user: "notmumbai@gmail.com",
        pass: "djbz wrcn uwtt woob",
    },
});

exports.createCorporateProfile = async (req, res) => {
    try {
        const {
            companyName,
            industryType,
            companySize,
            location,
            hrContact,
            userId,
        } = req.body;

        // Check if user exists
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        // Check if profile already exists for this user
        const existingProfile = await CorporateClubAdmin.findOne({ userId });
        if (existingProfile) {
            return res
                .status(400)
                .json({ message: "Corporate profile already exists for this user" });
        }

        const newProfile = new CorporateClubAdmin({
            companyName,
            industryType,
            companySize,
            location,
            hrContact,
            userId,
        });

        await newProfile.save();

        res.status(201).json({
            message: "Corporate profile created successfully",
            profile: newProfile,
        });
    } catch (error) {
        console.error("Error creating corporate profile:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

exports.getCorporateProfile = async (req, res) => {
    try {
        const { userId } = req.params;

        // Validate userId format
        if (!userId.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({ message: "Invalid userId format" });
        }

        const user = await User.findById(userId).select("name email mobile");
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const corporateProfile = await CorporateClubAdmin.findOne({ userId });
        if (!corporateProfile) {
            return res.status(404).json({ message: "Corporate profile not found" });
        }

        res.json({
            user: user,
            corporateProfile,
        });
    } catch (error) {
        console.error("Error fetching corporate profile:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

exports.updateCorporateProfile = async (req, res) => {
    try {
        const { userId } = req.params;
        const { name, email, mobile, ...corporateData } = req.body;

        // Build update object for User
        const userUpdateFields = {};
        if (req.body.hasOwnProperty("name")) userUpdateFields.name = name;
        if (req.body.hasOwnProperty("email")) userUpdateFields.email = email;
        if (req.body.hasOwnProperty("mobile")) userUpdateFields.mobile = mobile;

        // Update User document
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            userUpdateFields,
            { new: true, runValidators: true }
        );

        if (!updatedUser) {
            return res.status(404).json({ message: "User not found" });
        }

        // Update Corporate Profile
        const updatedProfile = await CorporateClubAdmin.findOneAndUpdate(
            { userId },
            { $set: corporateData },
            { new: true, runValidators: true }
        );

        if (!updatedProfile) {
            return res.status(404).json({ message: "Corporate profile not found" });
        }

        res.json({
            message: "Profile updated successfully",
            profile: {
                ...updatedUser.toObject(),
                ...updatedProfile.toObject(),
            },
        });
    } catch (error) {
        console.error("Error updating corporate profile:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

exports.addManager = async (req, res) => {
    const { name, email, password, userId } = req.body; // userId is Corporate Admin's ID

    if (!name || !email || !password || !userId) {
        return res.status(400).json({ error: "All fields are required." });
    }

    try {
        // Check if user (Corporate Admin) exists
        const admin = await User.findById(userId);
        if (!admin) {
            return res.status(404).json({ message: "Admin user not found" });
        }

        // Check if email already exists in User or Manager
        const existingUser = await User.findOne({ email });
        const existingManager = await Manager.findOne({ email });

        if (existingUser || existingManager) {
            return res.status(400).json({ error: "Email is already in use." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Create Manager linked to this Corporate Admin (User)
        const newManager = new Manager({
            name,
            email,
            password: hashedPassword,
            clubId: userId, // Link to Corporate Admin
            isActive: true,
        });

        await newManager.save();

        // Send Email with Credentials to the new Manager
        const loginLink = `http://localhost:5173/login`;

        const mailOptions = {
            from: "notmumbai@gmail.com",
            to: email,
            subject: "Welcome to Sportszz - Manager Credentials",
            text: `Hello ${name},\n\nYou have been added as a Manager for your organization's sports activities.\n\nHere are your login credentials:\nEmail: ${email}\nPassword: ${password}\n\nPlease login here: ${loginLink}\n\nBest Regards,\nSportszz Team`,
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error("Error sending email to manager:", error);
            } else {
                console.log("Manager credential email sent:", info.response);
            }
        });

        res.status(201).json({
            message: "Manager created successfully and credentials sent.",
            manager: newManager,
        });
    } catch (error) {
        console.error("Error adding manager:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

exports.onboardCorporateAdmin = async (req, res) => {
    const {
        name,
        email,
        phone,
        companyName,
        industryType,
        companySize,
        location,
        designation
    } = req.body;

    if (!name || !email || !companyName) {
        return res.status(400).json({ message: "Required fields missing." });
    }

    try {
        // 1. Check if user exists
        let user = await User.findOne({ email });
        if (user) {
            return res.status(400).json({ message: "User with this email already exists." });
        }

        // 2. Generate Password (random 8 chars)
        const generatedPassword = Math.random().toString(36).slice(-8);
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(generatedPassword, salt);

        // 3. Create User
        const newUser = new User({
            name,
            email,
            mobile: phone,
            password: generatedPassword, // User model will hash it if logic exists, but let's see. 
            // The User model has a pre-save hook that hashes the password if modified.
            // So passing plain text 'generatedPassword' is correct.
            role: "corporate_admin", // Explicit role
            isApproved: true,
            emailVerified: true
        });
        await newUser.save();

        // 4. Create Corporate Profile
        const newProfile = new CorporateClubAdmin({
            companyName,
            industryType,
            companySize,
            location,
            hrContact: {
                name,
                designation: designation || "Admin",
                contactNumber: phone,
                email: email
            },
            userId: newUser._id
        });
        await newProfile.save();

        // 5. Send Email with Credentials
        const loginLink = `https://your-app-url.com/login`; // Replace with actual URL

        const mailOptions = {
            from: "notmumbai@gmail.com",
            to: email,
            subject: "Welcome to Sportszz - Corporate Admin Credentials",
            text: `Hello ${name},\n\nYour Corporate Admin account has been created successfully.\n\nHere are your login credentials:\nEmail: ${email}\nPassword: ${generatedPassword}\n\nPlease login here: ${loginLink}\n\nBest Regards,\nSportszz Team`,
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error("Error sending email:", error);
            } else {
                console.log("Email sent:", info.response);
            }
        });

        res.status(201).json({
            message: "Corporate Admin onboarded successfully and email sent.",
            credentials: {
                email,
                password: generatedPassword
            },
            user: newUser,
            profile: newProfile
        });

    } catch (error) {
        console.error("Error onboarding corporate admin:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
};
