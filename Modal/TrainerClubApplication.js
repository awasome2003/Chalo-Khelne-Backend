// Modal/ClubApplication.js
const mongoose = require("mongoose");

const ClubApplicationSchema = new mongoose.Schema({
  trainerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  clubId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  clubName: {
    type: String,
    required: true,
  },
  turfId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Turf",
    required: true,
  },
  turfName: {
    type: String,
    required: true,
  },
  // Change this to an array of managers with their individual statuses
  assignedManagers: [
    {
      managerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Manager",
        required: true,
      },
      status: {
        type: String,
        enum: ["pending", "approved", "rejected"],
        default: "pending",
      },
      reviewedAt: Date,
      reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Manager",
      },
      rejectionReason: String,
    },
  ],
  overallStatus: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending",
  },
  applicationMessage: {
    type: String,
    maxlength: 500,
  },
  trainerExperience: String,
  trainerSports: [String],
  certificates: [
    {
      name: String,
      issuedBy: String,
      issueDate: Date,
      expiryDate: Date,
      certificateId: String,
      certificateUrl: String,
      _id: mongoose.Schema.Types.ObjectId,
    },
  ],
  appliedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update the unique index
ClubApplicationSchema.index({ trainerId: 1, turfId: 1 }, { unique: true });

module.exports = mongoose.model("ClubApplication", ClubApplicationSchema);
