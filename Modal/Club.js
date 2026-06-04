const mongoose = require("mongoose");

/**
 * A sports club / academy directory entry shown in the trainer's
 * "Find Clubs" screen. Trainers can apply to clubs (via
 * TrainerClubApplication). Also resolves the `clubId` refs used by
 * Session.js and Request.js.
 */
const clubSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    shortCode: { type: String, default: "" }, // avatar initials e.g. "BSA"
    logoColor: { type: String, default: "#15A765" },
    location: { type: String, default: "" },
    membersCount: { type: Number, default: 0 },
    sports: { type: [String], default: [] },
    amenities: { type: [String], default: [] }, // gym | pool | parking | wifi
    isHiring: { type: Boolean, default: false },
    description: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

clubSchema.index({ isHiring: 1, sports: 1 });
// Find Clubs list: sorted by membership size.
clubSchema.index({ membersCount: -1 });

module.exports = mongoose.model("Club", clubSchema);
