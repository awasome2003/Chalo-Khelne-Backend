/**
 * Agency Admin onboarding — SuperAdmin creates a tournament-agency account.
 * Creates a User with role "AgencyAdmin" (their own _id becomes the agencyId).
 * Mirrors onboardClubAdmin, minus the club profile.
 */
const User = require("../src/modules/identity/models/User");

exports.onboardAgency = async (req, res) => {
  const { name, email, phone, agencyName, city } = req.body;
  // `mobile` is a required field on the User model, so phone is mandatory here
  // (the SuperAdmin onboarding form already marks Phone as required). Validate
  // it explicitly to return a clean 400 instead of a Mongoose 500.
  if (!name || !email || !phone) {
    return res.status(400).json({ message: "Name, email and phone are required." });
  }
  try {
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: "User with this email already exists." });

    const generatedPassword = Math.random().toString(36).slice(-8);
    const newUser = new User({
      name,
      email,
      mobile: phone || "",
      password: generatedPassword,      // hashed by the User pre-save hook
      role: "AgencyAdmin",
      roles: ["AgencyAdmin"],
      clubName: agencyName || name,     // agency display name
      isApproved: true,
      emailVerified: true,
    });
    await newUser.save();

    return res.status(201).json({
      success: true,
      message: "Agency account created",
      credentials: { email, password: generatedPassword },
      tempPassword: generatedPassword,
      user: { _id: newUser._id, name: newUser.name, email: newUser.email, role: newUser.role },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

exports.listAgencies = async (req, res) => {
  try {
    const agencies = await User.find({ role: "AgencyAdmin" }).select("-password").sort({ createdAt: -1 }).lean();
    return res.json({ success: true, count: agencies.length, agencies });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};
