const mongoose = require("mongoose");

/**
 * ClubCoach — a coach/trainer on a facility Club's roster (Club OS). Tenant-scoped
 * by clubId. Assigning a session bumps sessionsCount + earnings and auto-posts a
 * Staff Salary payroll expense (clubCoachController). Distinct from the academy
 * `Trainer` model (trainer-console / certification flow).
 */
const clubCoachSchema = new mongoose.Schema(
  {
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true },
    sport: { type: String, default: "" },
    availability: { type: [String], default: [] },
    hourlyRate: { type: Number, default: 0, min: 0 },
    rating: { type: Number, default: 5, min: 0, max: 5 },
    sessionsCount: { type: Number, default: 0, min: 0 },
    earnings: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ["Available", "On Session", "On Leave"], default: "Available" },
    attendanceToday: { type: String, enum: ["Present", "Absent", "On Leave", "Not Set"], default: "Not Set" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

clubCoachSchema.index({ clubId: 1, createdAt: 1 });

module.exports = mongoose.model("ClubCoach", clubCoachSchema);
