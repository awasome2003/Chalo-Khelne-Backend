const mongoose = require("mongoose");

const plannerNoteSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    sport: { type: String, default: "Personal Note", trim: true },

    // Display fields kept compatible with the Planner UI activity shape
    time: { type: String, default: "All Day" }, // e.g. "3:30 – 5:00 PM"
    location: { type: String, default: "" },
    date: { type: String, required: true, index: true }, // YYYY-MM-DD
    type: { type: String, default: "Personal Note" },
    color: { type: String, default: "#8E8E93" },
    tag: { type: String, default: "Note" },
    description: { type: String, default: "" },

    // Reminder fields — when reminder is true and reminderAt is in the future,
    // the planner reminder cron will pick this up and send an Expo push.
    reminder: { type: Boolean, default: false },
    reminderAt: { type: Date, default: null, index: true }, // computed from date + time
    reminderProcessed: { type: Boolean, default: false, index: true },
    reminderSentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Composite index for the "user's notes in a date window" query
plannerNoteSchema.index({ userId: 1, date: 1 });
// Composite index the reminder cron uses
plannerNoteSchema.index({ reminder: 1, reminderProcessed: 1, reminderAt: 1 });

module.exports = mongoose.model("PlannerNote", plannerNoteSchema);
