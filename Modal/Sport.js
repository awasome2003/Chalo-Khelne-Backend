const mongoose = require("mongoose");

const matchFormatSchema = new mongoose.Schema(
  {
    // Sets-based sports (Badminton, TT, Tennis, Volleyball, Pickleball)
    totalSets: { type: Number, default: null },
    gamesPerSet: { type: Number, default: null },
    pointsPerSet: { type: Number, default: null },
    pointsPerGame: { type: Number, default: null },
    winByMargin: { type: Number, default: null },
    maxPointsCap: { type: Number, default: null },

    // Deuce rules
    deuceEnabled: { type: Boolean, default: false },
    deuceMinPoints: { type: Number, default: null },

    // Tiebreak rules (Tennis)
    tiebreakEnabled: { type: Boolean, default: false },
    tiebreakPoints: { type: Number, default: null },

    // Deciding set (Volleyball: 15 instead of 25)
    decidingSetPoints: { type: Number, default: null },

    // Service rules
    serviceRules: {
      type: String,
      enum: [
        "rally",
        "alternate-2",
        "alternate-game",
        "side-out",
        "rotate",
        null,
      ],
      default: null,
    },

    // Halves-based sports (Football, Hockey, Kabaddi)
    halvesCount: { type: Number, default: null },
    halvesDuration: { type: Number, default: null },

    // Quarters-based sports (Basketball)
    quartersCount: { type: Number, default: null },
    quartersDuration: { type: Number, default: null },

    // Innings-based sports (Cricket)
    oversCount: { type: Number, default: null },
    inningsCount: { type: Number, default: null },
  },
  { _id: false }
);

const displayConfigSchema = new mongoose.Schema(
  {
    icon: { type: String, default: "default-sport" },
    color: { type: String, default: "#4CAF50" },
    scoreLabel: { type: String, default: "Score" },
    setLabel: { type: String, default: "Set" },
    pointLabel: { type: String, default: "Point" },
  },
  { _id: false }
);

const sportSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
    },
    category: {
      type: String,
      enum: ["Racquet", "Team", "Board", "Individual", "Custom"],
      required: true,
    },
    scoringType: {
      type: String,
      enum: [
        "sets-games-points",
        "innings-overs",
        "halves-goals",
        "quarters-points",
        "single-score",
        "custom",
      ],
      required: true,
    },
    matchFormat: {
      type: matchFormatSchema,
      default: () => ({}),
    },
    displayConfig: {
      type: displayConfigSchema,
      default: () => ({}),
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isPreset: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Indexes
sportSchema.index({ category: 1 });
sportSchema.index({ isActive: 1 });

// Auto-generate slug from name before validation
sportSchema.pre("validate", function (next) {
  if (this.name && !this.slug) {
    this.slug = this.name.toLowerCase().replace(/\s+/g, "-");
  }
  next();
});

module.exports = mongoose.model("Sport", sportSchema);
