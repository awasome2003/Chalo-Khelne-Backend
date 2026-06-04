const mongoose = require("mongoose");

/**
 * A professional service profile a player can offer (referee, coach, etc.).
 * One user may hold several profiles — one per role — so the unique index
 * is on { userId, role }. Marketplace-style; independent of tournaments.
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

const EXPERIENCE_LEVELS = ["fresher", "intermediate", "professional", "experienced"];
const AVAILABILITY = ["full_time", "part_time", "weekends_only", "event_based", "flexible_hours"];
const RATE_TYPES = ["per_hour", "per_match", "per_day"];

const TIER_BY_LEVEL = {
  fresher: "Fresher",
  intermediate: "Intermediate",
  professional: "Professional",
  experienced: "Experienced",
};

const professionalProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    role: { type: String, enum: ROLES, required: true },
    sports: { type: [String], default: [] },
    city: { type: String, default: "" },
    experienceLevel: { type: String, enum: EXPERIENCE_LEVELS, default: "intermediate" },
    availability: { type: [{ type: String, enum: AVAILABILITY }], default: [] },
    rateType: { type: String, enum: RATE_TYPES, default: "per_hour" },
    rateAmount: { type: Number, default: 0 },
    negotiable: { type: Boolean, default: false },
    about: { type: String, default: "" },
    certificates: {
      type: [
        {
          name: { type: String, default: "" },
          uri: { type: String, default: "" },
          mimeType: { type: String, default: "" },
        },
      ],
      default: [],
    },
    // Derived/aggregated display fields
    rating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    tier: { type: String, default: "Professional" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// One profile per role per user.
professionalProfileSchema.index({ userId: 1, role: 1 }, { unique: true });
// Hire directory: active pros by role, highest-rated first.
professionalProfileSchema.index({ isActive: 1, role: 1, rating: -1 });

// Keep the display tier in sync with the experience level.
professionalProfileSchema.pre("save", function (next) {
  this.tier = TIER_BY_LEVEL[this.experienceLevel] || "Professional";
  next();
});

professionalProfileSchema.statics.ROLES = ROLES;
professionalProfileSchema.statics.EXPERIENCE_LEVELS = EXPERIENCE_LEVELS;
professionalProfileSchema.statics.AVAILABILITY = AVAILABILITY;
professionalProfileSchema.statics.RATE_TYPES = RATE_TYPES;

module.exports = mongoose.model("ProfessionalProfile", professionalProfileSchema);
