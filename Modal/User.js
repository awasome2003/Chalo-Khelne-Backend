const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema({
  // Basic Information
  playerId: { type: String, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  mobile: { type: String, required: true },
  dateOfBirth: { type: Date, required: true },
  age: { type: Number },
  sex: { type: String, enum: ["male", "female", "other"] },

  // Sports and Clubs
  sports: [
    {
      type: String,
      enum: ["table-tennis", "cricket", "football"],
    },
  ],
  clubNames: [{ type: String }],

  // Contact Information
  emergencyContact: { type: String },
  address: { type: String },

  // Club Management (for ClubAdmin role)
  clubName: {
    type: String,
    required: false,
    trim: true,
  },
  clubId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: false, // Not required for mobile users, only for ClubAdmin
  },

  // Identity Information
  identityType: {
    type: String,
    enum: ["aadhar-card", "pan-card"],
  },
  identityId: {
    type: String,
    validate: {
      validator: function (v) {
        if (!v) return true; // Allow empty values
        if (this.identityType === "aadhar-card") {
          return /^\d{12}$/.test(v);
        }
        if (this.identityType === "pan-card") {
          return /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(v);
        }
        return false;
      },
      message: function(props) {
        if (this.identityType === "aadhar-card") {
          return "Aadhar number must be exactly 12 digits";
        }
        if (this.identityType === "pan-card") {
          return "PAN number must be in format ABCDE1234F";
        }
        return "Invalid identity number format";
      },
    },
  },
  identityDocument: {
    path: { type: String },
    name: { type: String },
    type: { type: String },
    uploadedAt: { type: Date, default: Date.now },
  },

  // Additional Information
  rank: { type: String },
  achievements: { type: String },
  bio: { type: String },
  referralCode: { type: String },

  // Files
  profileImage: {
    type: String,
    default: null,
    get: function (v) {
      return v ? v.replace(/\\/g, "/") : null;
    },
  },
  certificates: [
    {
      path: { type: String, required: true },
      name: { type: String, required: true },
      type: { type: String, required: true },
      uploadedAt: { type: Date, default: Date.now },
    },
  ],

  // Authentication & OAuth
  password: { type: String, required: true },
  role: { type: String, required: true },
  isApproved: { type: Boolean, default: false },
  googleId: { type: String, sparse: true },
  authProvider: { type: String, enum: ["local", "google"], default: "local" },
  emailVerified: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  profilePicture: { type: String }, // For Google profile pictures
  needsMobileUpdate: { type: Boolean, default: false },

  // Child Safety & Parental Controls
  isMinor: { type: Boolean, default: false },
  ageGroup: { type: String, enum: ["under13", "13to17", "adult"], default: "adult" },
  parentalConsent: { type: Boolean, default: false },
  privacyPolicyAccepted: { type: Boolean, default: false },
  privacyPolicyAcceptedAt: { type: Date },
  parentalControls: {
    enabled: { type: Boolean, default: false },
    pin: { type: String, default: null },
    allowMessaging: { type: Boolean, default: true },
    allowSocial: { type: Boolean, default: true },
    allowMediaSharing: { type: Boolean, default: true },
  },

  // Push Notifications
  expoPushToken: {
    type: String,
    default: null,
  },

  // Metadata
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Pre-save middleware
UserSchema.pre("save", async function (next) {
  if (this.isModified("password")) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }

  // Auto-calculate isMinor and ageGroup from dateOfBirth
  if (this.isModified("dateOfBirth") && this.dateOfBirth) {
    const today = new Date();
    const dob = new Date(this.dateOfBirth);
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      age--;
    }
    this.age = age;
    this.isMinor = age < 18;
    if (age < 13) {
      this.ageGroup = "under13";
    } else if (age < 18) {
      this.ageGroup = "13to17";
    } else {
      this.ageGroup = "adult";
    }
  }

  // Hash parental PIN if modified
  if (this.isModified("parentalControls.pin") && this.parentalControls?.pin) {
    const salt = await bcrypt.genSalt(10);
    this.parentalControls.pin = await bcrypt.hash(this.parentalControls.pin, salt);
  }

  this.updatedAt = Date.now();
  next();
});

// Methods
UserSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

UserSchema.methods.compareParentalPin = async function (candidatePin) {
  if (!this.parentalControls?.pin) return false;
  return await bcrypt.compare(candidatePin, this.parentalControls.pin);
};

// Indexes for performance optimization
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ email: 1, role: 1 });
UserSchema.index({ playerId: 1 }, { unique: true, sparse: true });
UserSchema.index({ googleId: 1 }, { sparse: true });
UserSchema.index({ role: 1 });
UserSchema.index({ clubId: 1 }, { sparse: true });

module.exports = mongoose.model("User", UserSchema);