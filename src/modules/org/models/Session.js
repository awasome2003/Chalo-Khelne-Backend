// Session.js - Updated Model
const mongoose = require("mongoose");

const SessionSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ["personal", "group", "intermediate", "academy"],
    required: true,
  },
  startTime: {
    type: Date,
    required: true,
  },
  endTime: {
    type: Date,
    required: true,
  },
  location: {
    type: String,
    required: true,
  },
  trainerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Trainer",
    required: true,
  },
  players: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],
  clubId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Club",
  },
  sportType: {
    type: String,
    required: true,
  },
  maxParticipants: {
    type: Number,
    default: 1,
  },
  currentParticipants: {
    type: Number,
    default: 0,
  },
  price: {
    type: Number,
    required: true,
  },
  status: {
    type: String,
    enum: ["scheduled", "in-progress", "completed", "cancelled"],
    default: "scheduled",
  },
  notes: {
    type: String,
  },
  recurringPattern: {
    type: String,
    enum: ["none", "daily", "weekly", "monthly"],
    default: "none",
  },
  recurringEndDate: {
    type: Date,
  },
  feedback: [
    {
      playerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      rating: {
        type: Number,
        min: 1,
        max: 5,
      },
      comment: {
        type: String,
      },
      createdAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Add indexes for efficient querying
SessionSchema.index({ trainerId: 1, startTime: 1 });
SessionSchema.index({ players: 1 });
SessionSchema.index({ clubId: 1 });
SessionSchema.index({ startTime: 1, endTime: 1 });
SessionSchema.index({ status: 1 });
SessionSchema.index({ sportType: 1 });
SessionSchema.index({ "feedback.rating": 1 });
// Trainer dashboard/earnings: filter by trainer + status, newest first.
SessionSchema.index({ trainerId: 1, status: 1, startTime: -1 });

// Update the updatedAt timestamp before saving
SessionSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

// Automatically update the trainer's rating when feedback is added
SessionSchema.post("save", async function (doc) {
  if (doc.feedback && doc.feedback.length > 0) {
    try {
      const Trainer = mongoose.model("Trainer");
      const Session = mongoose.model("Session");

      // Compute the average in the DB (was: load all sessions + sum in app
      // memory, which lost-updates under concurrent feedback saves). Each
      // recompute reads the latest committed state, so the result stays
      // consistent instead of clobbering a stale in-memory tally.
      const [agg] = await Session.aggregate([
        { $match: { trainerId: doc.trainerId, "feedback.0": { $exists: true } } },
        { $unwind: "$feedback" },
        { $match: { "feedback.rating": { $gt: 0 } } },
        { $group: { _id: null, avg: { $avg: "$feedback.rating" }, count: { $sum: 1 } } },
      ]);

      const averageRating = agg ? agg.avg : 0;
      const totalFeedback = agg ? agg.count : 0;

      await Trainer.findByIdAndUpdate(doc.trainerId, {
        rating: Number(averageRating).toFixed(1),
        reviewCount: totalFeedback,
      });
    } catch (error) {
      console.error("Error updating trainer rating:", error);
    }
  }
});

// ── Tenancy decision (Phase 5): GENUINELY CROSS-TENANT — no plugin ────
// A Session is a trainer-led training session. Trainers are cross-tenant
// principals (no clubId context), and the `clubId` field refs the **Club**
// collection (directory id), NOT the SaaS tenant (ClubAdmin User _id). So
// tenantScope could never match and shadow mode was a permanent no-op. Removed.
// Isolation is by trainerId controller filters — correct for this model.

module.exports = mongoose.model("Session", SessionSchema);
