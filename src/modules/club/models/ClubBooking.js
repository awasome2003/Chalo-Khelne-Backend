const mongoose = require("mongoose");

/**
 * ClubBooking — a court reservation in a facility Club (Club OS). Tenant-scoped
 * by clubId. On create-if-paid and on cancel/refund it auto-posts to ClubFinance
 * and writes a ClubAudit entry (see clubBookingController).
 */
const clubBookingSchema = new mongoose.Schema(
  {
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    courtId: { type: mongoose.Schema.Types.ObjectId, ref: "ClubCourt", default: null },
    courtName: { type: String, default: "" },
    sport: { type: String, default: "" },
    customerName: { type: String, required: true, trim: true },
    customerPhone: { type: String, default: "" },
    date: { type: String, required: true }, // YYYY-MM-DD
    startTime: { type: String, default: "09:00" }, // HH:MM
    duration: { type: Number, default: 1, min: 0 }, // hours
    source: { type: String, enum: ["Mobile App", "Walk-in", "Admin Booking", "Corporate Booking", "School Booking"], default: "Walk-in" },
    isPaid: { type: Boolean, default: false },
    amount: { type: Number, default: 0, min: 0 },
    coachId: { type: mongoose.Schema.Types.ObjectId, ref: "ClubCoach", default: null },
    coachName: { type: String, default: "" },
    notes: { type: String, default: "" },
    isRecurring: { type: Boolean, default: false },
    recurrenceRule: { type: String, default: "" },
    status: { type: String, enum: ["Confirmed", "Cancelled"], default: "Confirmed" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

clubBookingSchema.index({ clubId: 1, date: 1 });

module.exports = mongoose.model("ClubBooking", clubBookingSchema);
