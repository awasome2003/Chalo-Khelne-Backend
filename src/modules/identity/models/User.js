const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema({
  // Basic Information
  playerId: { type: String }, // unique+sparse index declared below (avoid dup)
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  mobile: { type: String, required: true },
  // DOB is only required for end-user/individual roles that use the age-gated
  // social features (Families Policy). Business/admin accounts (ClubAdmin,
  // corporate_admin, Organization, etc.) are onboarded without a DOB.
  dateOfBirth: {
    type: Date,
    required: function () {
      return ["Player", "Trainer", "Referee"].includes(this.role);
    },
  },
  age: { type: Number },
  sex: { type: String, enum: ["male", "female", "other"] },

  // Set whenever the password changes; used to make password-reset tokens single-use.
  passwordChangedAt: { type: Date },

  // ── Account status (SuperAdmin-controlled via /api/roles/users/:userId/status) ──
  // "active"     → normal use
  // "suspended"  → SA-suspended; blocked at login + every API call
  // "rejected"   → SA-rejected; blocked at login + every API call
  // Orthogonal to `isApproved` (approval flow for ClubAdmin/Organization).
  status: {
    type: String,
    enum: ["active", "suspended", "rejected"],
    default: "active",
    index: true,
  },
  suspensionReason: { type: String, default: null },
  suspendedAt: { type: Date, default: null },
  suspendedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SuperAdmin",
    default: null,
  },

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
  coverImage: {
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
  // Multi-role support — a user may be Player, Trainer, and Umpire at once.
  // `role` above stays as the primary/active role for backward compat.
  roles: {
    type: [String],
    default: [],
  },
  // Event OS tenancy — for agency staff (event_manager/coordinator/field staff),
  // points to the Agency Admin's User._id. Null for agency admins themselves
  // (their own _id IS the agencyId) and for non-agency users.
  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  // Social graph — Instagram-style public follow.
  followers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  following: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  isApproved: { type: Boolean, default: false },
  googleId: { type: String }, // sparse index declared below (avoid dup)
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
// email unique index comes from the field-level `unique: true` (no dup here).
UserSchema.index({ email: 1, role: 1 });
UserSchema.index({ playerId: 1 }, { unique: true, sparse: true });
UserSchema.index({ googleId: 1 }, { sparse: true });
UserSchema.index({ role: 1 });
UserSchema.index({ clubId: 1 }, { sparse: true });

// Defense-in-depth: never serialize secrets, even if a query forgets to exclude
// them. (Note: .lean() bypasses this — keep using `.select("-password")` there.)
UserSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete ret.password;
    if (ret.parentalControls) delete ret.parentalControls.pin;
    return ret;
  },
});

// ── Cascade cleanup (Phase 3) ──
// When a User is deleted, remove the records they own / are linked to, so
// queries don't return dangling references. Models are resolved lazily from
// the registry (no imports → no circular deps); missing models are skipped.
async function cascadeDeleteUser(userId) {
  if (!userId) return;
  const m = (n) => mongoose.models[n];
  const ops = [];
  if (m("ProfessionalProfile")) ops.push(m("ProfessionalProfile").deleteMany({ userId }));
  if (m("JobApplication")) ops.push(m("JobApplication").deleteMany({ applicantId: userId }));
  if (m("HireRequest"))
    ops.push(m("HireRequest").deleteMany({ $or: [{ fromUserId: userId }, { toUserId: userId }] }));
  if (m("Request"))
    ops.push(m("Request").deleteMany({ $or: [{ trainerId: userId }, { playerId: userId }] }));
  if (m("TrainerBatch")) ops.push(m("TrainerBatch").deleteMany({ trainerId: userId }));
  if (m("ClubRequest")) ops.push(m("ClubRequest").deleteMany({ trainerId: userId }));
  if (m("Invitation"))
    ops.push(m("Invitation").deleteMany({ $or: [{ senderId: userId }, { receiverId: userId }] }));
  if (m("Trainer")) {
    const trainer = await m("Trainer").findOne({ userId }).select("_id").lean();
    if (trainer && m("Session")) ops.push(m("Session").deleteMany({ trainerId: trainer._id }));
    ops.push(m("Trainer").deleteMany({ userId }));
  }
  await Promise.all(ops);
}

// findByIdAndDelete + findOneAndDelete both trigger "findOneAndDelete".
UserSchema.pre("findOneAndDelete", async function (next) {
  try {
    await cascadeDeleteUser((this.getFilter() || {})._id);
  } catch (e) {
    console.error("[User cascade] cleanup failed:", e.message);
  }
  next(); // never block the delete on cleanup failure
});
UserSchema.pre("deleteOne", { document: false, query: true }, async function (next) {
  try {
    await cascadeDeleteUser((this.getFilter() || {})._id);
  } catch (e) {
    console.error("[User cascade] cleanup failed:", e.message);
  }
  next();
});

module.exports = mongoose.model("User", UserSchema);