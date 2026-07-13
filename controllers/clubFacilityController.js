/**
 * Club (facility-business) onboarding — SuperAdmin creates a facility club account.
 * Creates a User with role "club_admin" (their own _id becomes the clubId tenant key).
 * This is the NEW facility-business Club flow (courts/bookings/members/POS), SEPARATE
 * from the legacy academy ClubAdmin flow. Mirrors onboardAgency.
 */
const User = require("../src/modules/identity/models/User");

exports.onboardClubFacility = async (req, res) => {
  const { name, email, phone, clubName, city } = req.body;
  // `mobile` is required on the User model — validate phone explicitly (clean 400).
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
      mobile: phone,
      password: generatedPassword, // hashed by the User pre-save hook
      role: "club_admin",
      roles: ["club_admin"],
      clubName: clubName || name, // facility display name
      isApproved: true,
      emailVerified: true,
    });
    await newUser.save();

    return res.status(201).json({
      success: true,
      message: "Club (facility) account created",
      credentials: { email, password: generatedPassword },
      tempPassword: generatedPassword,
      user: { _id: newUser._id, name: newUser.name, email: newUser.email, role: newUser.role },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

exports.listClubFacilities = async (req, res) => {
  try {
    const clubs = await User.find({ role: "club_admin" }).select("-password").sort({ createdAt: -1 }).lean();
    return res.json({ success: true, count: clubs.length, clubs });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};
