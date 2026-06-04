const mongoose = require("mongoose");

/**
 * A professional's application to a JobPosting. Status flows
 * pending → shortlist → accepted | rejected. Denormalized job fields
 * keep the "Applications" list cheap to render.
 */
const jobApplicationSchema = new mongoose.Schema(
  {
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: "JobPosting", required: true, index: true },
    applicantId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    professionalProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProfessionalProfile",
      default: null,
    },
    coverMessage: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "shortlist", "accepted", "rejected"],
      default: "pending",
    },

    // Snapshot of the job at apply-time (for fast lists + accurate earnings)
    jobTitle: { type: String, default: "" },
    venue: { type: String, default: "" },
    sport: { type: String, default: "" },
    role: { type: String, default: "" },
    rate: { type: Number, default: 0 },
    rateUnit: { type: String, default: "per hour" },
    eventDate: { type: String, default: "" },
  },
  { timestamps: true }
);

// One application per job per applicant.
jobApplicationSchema.index({ jobId: 1, applicantId: 1 }, { unique: true });
// "My applications": a user's apps, newest first.
jobApplicationSchema.index({ applicantId: 1, createdAt: -1 });

module.exports = mongoose.model("JobApplication", jobApplicationSchema);
