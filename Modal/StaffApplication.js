/**
 * StaffApplication — Tracks applications from users who want to serve
 * as Trainer, Referee, Scorer, Cameraman, etc. for a tournament.
 *
 * Flow:
 *   1. User creates a service profile (Trainer/Referee/etc.) on mobile
 *   2. User browses tournaments and applies for a role
 *   3. Manager gets notification → reviews profile → accepts/rejects
 *   4. Accepted applicants appear in tournament staff list
 */
const mongoose = require("mongoose");

const staffApplicationSchema = new mongoose.Schema(
  {
    // Who is applying
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    userName: { type: String, required: true },
    userEmail: { type: String },
    userPhone: { type: String },
    userProfileImage: { type: String, default: null },

    // What role they're applying for
    role: {
      type: String,
      required: true,
      enum: ["trainer", "referee", "scorer", "cameraman", "commentator", "staff"],
    },

    // Which tournament they're applying to
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
    },
    tournamentName: { type: String },

    // Manager who owns the tournament
    managerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Manager",
    },

    // Application details
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "withdrawn"],
      default: "pending",
    },

    // Rate proposed by applicant
    rateAmount: { type: Number, default: null },
    rateType: {
      type: String,
      enum: ["per_hour", "per_day", "per_session", "per_tournament", null],
      default: null,
    },

    // Applicant's pitch / cover note
    message: { type: String, default: "" },

    // Sports the applicant is qualified for (from their service profile)
    sports: [{ type: String }],

    // Experience
    experience: { type: Number, default: 0 },
    experienceMonths: { type: Number, default: 0 },
    experienceLevel: { type: String, enum: ["fresher", "experienced", null], default: null },

    // Profile verification by manager
    isVerified: { type: Boolean, default: false },
    verifiedAt: { type: Date, default: null },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Manager", default: null },
    verificationNote: { type: String, default: "" },

    // Reference to their service profile (Trainer/Referee model ID)
    serviceProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    // Manager response
    managerNote: { type: String, default: "" },
    respondedAt: { type: Date, default: null },
    respondedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Manager",
      default: null,
    },
    // Stages this umpire is authorized to officiate (for role="referee").
    // Empty array = all stages (backward-compat default for pre-Phase-4 accepted applications).
    // Explicit values: subset of ["group-stage", "knockout"].
    stages: [{
      type: String,
      enum: ["group-stage", "knockout"],
    }],
  },
  { timestamps: true }
);

// Prevent duplicate applications (same user + same tournament + same role)
staffApplicationSchema.index(
  { userId: 1, tournamentId: 1, role: 1 },
  { unique: true }
);

// Fast lookups
staffApplicationSchema.index({ tournamentId: 1, status: 1 });
staffApplicationSchema.index({ userId: 1, status: 1 });
staffApplicationSchema.index({ managerId: 1, status: 1 });

module.exports = mongoose.model("StaffApplication", staffApplicationSchema);
