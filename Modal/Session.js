// Session.js - Updated Model
const mongoose = require("mongoose");

const SessionSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ["personal", "group", "intermediate"],
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

      // Get all sessions for this trainer with feedback
      const Session = mongoose.model("Session");
      const sessions = await Session.find({
        trainerId: doc.trainerId,
        "feedback.0": { $exists: true },
      });

      // Calculate average rating
      let totalRating = 0;
      let totalFeedback = 0;

      sessions.forEach((session) => {
        session.feedback.forEach((item) => {
          if (item.rating) {
            totalRating += item.rating;
            totalFeedback++;
          }
        });
      });

      const averageRating = totalFeedback > 0 ? totalRating / totalFeedback : 0;

      // Update trainer rating and reviewCount
      await Trainer.findByIdAndUpdate(doc.trainerId, {
        rating: averageRating.toFixed(1),
        reviewCount: totalFeedback,
      });
    } catch (error) {
      console.error("Error updating trainer rating:", error);
    }
  }
});

module.exports = mongoose.model("Session", SessionSchema);
