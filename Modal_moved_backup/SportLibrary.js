const mongoose = require("mongoose");

/**
 * SportLibrary — encyclopedic / educational content for the in-app Sports
 * Library module. Managed by Super Admin. Distinct from the scoring-engine
 * `Sport` model (which configures match formats / points). This holds the
 * "about / rules / court info / beginner tips" reference content + display
 * metadata shown to players.
 */

// A flexible content section: a title plus any of text / bullet points /
// a highlighted spec block. Used by About, Court Info, Rules sections.
const sectionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    text: { type: String, default: "" },
    points: { type: [String], default: [] },
    highlightBlock: { type: [String], default: [] },
  },
  { _id: false }
);

// Tips sections carry a render `type` controlling the bullet style.
const tipSectionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["numbered", "cross", "bullet"],
      default: "bullet",
    },
    points: { type: [String], default: [] },
  },
  { _id: false }
);

const sportLibrarySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    slug: { type: String, unique: true, lowercase: true, trim: true },
    type: {
      type: String,
      enum: ["Indoor", "Outdoor"],
      default: "Outdoor",
    },
    description: { type: String, default: "" },

    // Display metadata (mirrors the static card design)
    iconName: { type: String, default: "trophy-outline" }, // MaterialCommunityIcons
    iconColor: { type: String, default: "#15A765" },
    iconBgColor: { type: String, default: "#E8F7F0" },
    image: { type: String, default: null }, // remote URL or uploads path

    // Admin-set stat numbers (computation can replace these later)
    popularity: { type: Number, default: 0, min: 0, max: 100 },
    eventsCount: { type: Number, default: 0 },
    playersCount: { type: String, default: "0" }, // "1250+" style string
    coaches: { type: Number, default: 0 },
    turfs: { type: Number, default: 0 },
    performance: { type: String, default: "0%" },

    // Rich content
    aboutSections: { type: [sectionSchema], default: [] },
    courtSections: { type: [sectionSchema], default: [] },
    tipsSections: { type: [tipSectionSchema], default: [] },
    rules: { type: [sectionSchema], default: [] },

    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 }, // manual sort order in the library list
  },
  { timestamps: true }
);

sportLibrarySchema.index({ isActive: 1 });
sportLibrarySchema.index({ order: 1 });

sportLibrarySchema.pre("validate", function (next) {
  if (this.name && !this.slug) {
    this.slug = this.name.toLowerCase().replace(/\s+/g, "-");
  }
  next();
});

module.exports = mongoose.model("SportLibrary", sportLibrarySchema);
