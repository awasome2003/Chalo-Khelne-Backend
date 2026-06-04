const mongoose = require("mongoose");

/**
 * Connection between a trainer and a Club (directory):
 *   - kind "application" : trainer applied to the club (Find Clubs → Apply)
 *   - kind "invite"      : club invited/hired the trainer (shown under
 *                          Requests → Club tab, trainer can accept/reject)
 *
 * Kept separate from the turf-coupled TrainerClubApplication model.
 */
const clubRequestSchema = new mongoose.Schema(
  {
    trainerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: "Club", required: true },
    clubName: { type: String, default: "" },
    sport: { type: String, default: "" },
    kind: { type: String, enum: ["application", "invite"], default: "application" },
    status: { type: String, enum: ["pending", "accepted", "rejected"], default: "pending" },
    message: { type: String, default: "" },
  },
  { timestamps: true }
);

clubRequestSchema.index({ trainerId: 1, clubId: 1, kind: 1 }, { unique: true });
// Requests tab + dashboard count: a trainer's invites by status, newest first.
clubRequestSchema.index({ trainerId: 1, kind: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("ClubRequest", clubRequestSchema);
