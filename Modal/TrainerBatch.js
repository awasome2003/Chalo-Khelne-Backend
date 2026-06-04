const mongoose = require("mongoose");

/**
 * A recurring coaching batch run by a trainer (e.g. "Morning Football Elite").
 * trainerId refs the User (the trainer's account), matching how Request.trainerId
 * is stored, so the console can query batches by the logged-in user directly.
 */
const trainerBatchSchema = new mongoose.Schema(
  {
    trainerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true },
    sport: { type: String, default: "" },
    level: {
      type: String,
      enum: ["beginner", "intermediate", "advanced", "kids", "professional"],
      default: "beginner",
    },
    capacity: { type: Number, default: 0 },
    enrolledCount: { type: Number, default: 0 },
    enrolledPlayers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    scheduleDays: { type: [String], default: [] }, // ["Mon","Wed","Fri"]
    startTime: { type: String, default: "" }, // "06:00 AM"
    endTime: { type: String, default: "" }, // "07:30 AM"
    location: { type: String, default: "" },
    monthlyFee: { type: Number, default: 0 },
    description: { type: String, default: "" },
  },
  { timestamps: true }
);

// Batches list: a trainer's batches, newest first.
trainerBatchSchema.index({ trainerId: 1, createdAt: -1 });

module.exports = mongoose.model("TrainerBatch", trainerBatchSchema);
