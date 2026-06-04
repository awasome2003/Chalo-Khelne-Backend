const mongoose = require("mongoose");

/**
 * A standalone "Sports Job" posting in the marketplace (referee needed,
 * coach needed, etc.). Not tied to a tournament; an organizer/manager
 * posts it and professionals apply. Seeded for now; posting UI comes later.
 */
const ROLES = [
  "referee",
  "coach",
  "scorer",
  "cameraman",
  "commentator",
  "event_staff",
  "physiotherapist",
  "photographer",
  "ground_staff",
];

const jobPostingSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    role: { type: String, enum: ROLES, default: "referee" },
    sport: { type: String, default: "" },
    venue: { type: String, default: "" },
    location: { type: String, default: "" },
    address: { type: String, default: "" },
    managerName: { type: String, default: "" },

    organizer: {
      name: { type: String, default: "" },
      description: { type: String, default: "" },
      rating: { type: Number, default: 0 },
      events: { type: Number, default: 0 },
      successRate: { type: Number, default: 0 },
    },

    description: { type: String, default: "" },
    about: { type: String, default: "" },

    schedule: {
      type: [
        {
          title: { type: String, default: "" },
          date: { type: String, default: "" },
          time: { type: String, default: "" },
        },
      ],
      default: [],
    },
    requirements: { type: [String], default: [] },
    benefits: { type: [String], default: [] },

    // Pricing
    rate: { type: Number, default: 0 },
    rateUnit: { type: String, default: "per hour" },
    ratePerMatch: { type: Number, default: 0 },
    matches: { type: Number, default: 0 },
    estimatedEarnings: { type: Number, default: 0 },

    applicantsCount: { type: Number, default: 0 },
    status: { type: String, enum: ["open", "closed"], default: "open" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

jobPostingSchema.index({ status: 1, role: 1, sport: 1 });
// Browse list: open jobs, newest first.
jobPostingSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("JobPosting", jobPostingSchema);
