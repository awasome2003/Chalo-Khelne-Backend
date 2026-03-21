const ClubAdmin = require("../Modal/ClubAdminProfile");
const User = require("../Modal/User");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: "notmumbai@gmail.com",
    pass: "djbz wrcn uwtt woob",
  },
});

exports.getClubAdminProfile = async (req, res) => {
  try {
    const { userId } = req.params;

    // Validate userId is a valid ObjectId
    if (!userId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: "Invalid userId format" });
    }

    // Fetch User info - adjust field names as per your schema
    const user = await User.findById(userId).select("clubName email mobile"); // singular clubName?
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Fetch ClubAdmin profile - check if field name is "userId" or "user"
    const clubProfile = await ClubAdmin.findOne({ userId: userId }); // explicit key:value
    if (!clubProfile) {
      return res.status(404).json({ message: "ClubAdmin profile not found" });
    }

    res.json({
      name: user.name,  // Adjust per your schema (clubName or clubNames)
      email: user.email,
      mobile: user.mobile,
      clubProfile,
    });
  } catch (error) {
    console.error("Error fetching club profile:", error);
    res.status(500).json({ message: "Server error" });
  }
};


// Update ClubAdminProfile
// exports.updateClubAdminProfile = async (req, res) => {
//   try {
//     const userId = req.params.userId;

//     // Destructure any user fields from the request body
//     const { name, email, mobile, ...clubAdminData } = req.body;

//     // Update the ClubAdminProfile
//     const updatedProfile = await ClubAdmin.findOneAndUpdate(
//       { userId },
//       { $set: clubAdminData },
//       { new: true, runValidators: true }
//     );

//     if (!updatedProfile) {
//       return res.status(404).json({ message: "ClubAdmin profile not found" });
//     }

//     // Update User document if fields provided
//     const updatedUser = await User.findByIdAndUpdate(
//       userId,
//       {
//         ...(name && { name }),
//         ...(email && { email }),
//         ...(mobile && { mobile }),
//       },
//       { new: true, runValidators: true }
//     );

//     res.json({
//       message: "Profile updated successfully",
//       updatedProfile,
//       updatedUser,
//     });
//   } catch (error) {
//     console.error("Error updating profile:", error);
//     res.status(500).json({ message: "Server error" });
//   }
// };

// exports.updateClubAdminProfile = async (req, res) => {
//   try {
//     const userId = req.params.userId;

//     // Destructure any user fields from the request body
//     const { name, email, mobile, ...clubAdminData } = req.body;

//     // Build update object for User
//     const userUpdateFields = {};
//     if (req.body.hasOwnProperty('name')) userUpdateFields.name = name;
//     if (req.body.hasOwnProperty('email')) userUpdateFields.email = email;
//     if (req.body.hasOwnProperty('mobile')) userUpdateFields.mobile = mobile;

//     // Update User document first
//     const updatedUser = await User.findByIdAndUpdate(
//       userId,
//       userUpdateFields,
//       { new: true, runValidators: true }
//     );

//     if (!updatedUser) {
//       return res.status(404).json({ message: "User not found" });
//     }

//     // Update the ClubAdmin profile
//     const updatedProfile = await ClubAdmin.findOneAndUpdate(
//       { userId },
//       { $set: clubAdminData },
//       { new: true, runValidators: true }
//     );

//     if (!updatedProfile) {
//       return res.status(404).json({ message: "ClubAdmin profile not found" });
//     }

//     res.json({
//       message: "Profile updated successfully",
//       updatedProfile,
//       updatedUser,
//     });
//   } catch (error) {
//     console.error("Error updating profile:", error);
//     res.status(500).json({ message: "Server error" });
//   }
// };

exports.updateClubAdminProfile = async (req, res) => {
  try {
    const userId = req.params.userId;
    const { name, email, mobile, ...clubAdminData } = req.body;

    const userUpdateFields = {};
    if (req.body.hasOwnProperty('name')) userUpdateFields.name = name;
    if (req.body.hasOwnProperty('email')) userUpdateFields.email = email;
    if (req.body.hasOwnProperty('mobile')) userUpdateFields.mobile = mobile;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      userUpdateFields,
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const updatedProfile = await ClubAdmin.findOneAndUpdate(
      { userId },
      { $set: clubAdminData },
      { new: true, runValidators: true }
    );

    if (!updatedProfile) {
      return res.status(404).json({ message: "ClubAdmin profile not found" });
    }

    // ✅ Send merged data to match frontend expectations
    res.json({
      message: "Profile updated successfully",
      clubProfile: {
        ...updatedUser.toObject(),
        ...updatedProfile.toObject(),
      }
    });

  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ message: "Server error" });
  }
};




// POST - Create ClubAdminProfile
exports.createClubAdminProfile = async (req, res) => {
  try {
    const {
      address,
      area,
      city,
      typeOfRegistration,
      registrationDate,
      sports,
      noOfPlayers,
      timeToOpen,
      timeToClose,
      contacts,
      clubPhotosID,
      clubVideosID,
      addressLink,
      validityDate,
      locations,
      authorizations,
      userId,
    } = req.body;

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Check if profile already exists for this user
    const existingProfile = await ClubAdmin.findOne({ userId });
    if (existingProfile) {
      return res
        .status(400)
        .json({ message: "ClubAdmin profile already exists for this user" });
    }

    const newProfile = new ClubAdmin({
      address,
      area,
      city,
      typeOfRegistration,
      registrationDate,
      sports,
      noOfPlayers,
      timeToOpen,
      timeToClose,
      contacts,
      clubPhotosID,
      clubVideosID,
      addressLink,
      validityDate,
      locations,
      authorizations,
      userId,
    });

    await newProfile.save();

    res.status(201).json({
      message: "ClubAdmin profile created successfully",
      profile: newProfile,
    });
  } catch (error) {
    console.error("Error creating club profile:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.onboardClubAdmin = async (req, res) => {
  const {
    name,
    email,
    phone,
    clubName,
    address,
    city,
    area,
    sports
  } = req.body;

  if (!name || !email || !clubName) {
    return res.status(400).json({ message: "Required fields missing." });
  }

  try {
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: "User with this email already exists." });
    }

    const generatedPassword = Math.random().toString(36).slice(-8);
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(generatedPassword, salt);

    const newUser = new User({
      name,
      email,
      mobile: phone,
      password: generatedPassword,
      role: "ClubAdmin",
      clubName,
      isApproved: true,
      emailVerified: true
    });
    await newUser.save();

    const newProfile = new ClubAdmin({
      address: address || "TBD",
      area: area || "TBD",
      city: city || "TBD",
      typeOfRegistration: "Private",
      registrationDate: new Date(),
      sports: sports || "Multi-sport",
      noOfPlayers: 0,
      timeToOpen: "06:00 AM",
      timeToClose: "10:00 PM",
      contacts: [{
        contactPersonName: name,
        designation: "Admin",
        contactNumber: phone
      }],
      locations: city || "TBD",
      userId: newUser._id
    });
    await newProfile.save();

    const loginLink = `http://localhost:5173/login`;

    const mailOptions = {
      from: "notmumbai@gmail.com",
      to: email,
      subject: "Welcome to Sportszz - Club Admin Credentials",
      text: `Hello ${name},\n\nYour Club Admin account for ${clubName} has been created successfully.\n\nHere are your login credentials:\nEmail: ${email}\nPassword: ${generatedPassword}\n\nPlease login here: ${loginLink}\n\nBest Regards,\nSportszz Team`,
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error("Error sending email:", error);
      } else {
        console.log("Email sent:", info.response);
      }
    });

    res.status(201).json({
      message: "Club Admin onboarded successfully and email sent.",
      credentials: {
        email,
        password: generatedPassword
      },
      user: newUser,
      profile: newProfile
    });

  } catch (error) {
    console.error("Error onboarding club admin:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
