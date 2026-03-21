// models/TurfBookingModel.js
const mongoose = require("mongoose");

const turfBookingSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    userName: {
      type: String,
      required: true,
    },
    userEmail: {
      type: String,
    },
    userPhone: {
      type: String,
    },
    turfId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Turf",
      required: true,
    },
    turfName: {
      type: String,
      required: true,
    },
    // Added sport field to match your Turf model sports array
    sport: {
      name: {
        type: String,
        required: true,
      },
      pricePerHour: {
        type: Number,
        required: true,
      },
    },
    date: {
      type: Date,
      required: true,
    },
    timeSlot: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "cancelled", "completed"],
      default: "confirmed",
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "refunded"],
      default: "pending",
    },
    paymentMethod: {
      type: String,
      default: "cash",
      enum: ["cash", "free", "waived"],
    },
    cancellationReason: String,
    cancellationDate: Date,
    notes: String,
  },
  {
    timestamps: true,
  }
);

// Add indexes for better query performance
turfBookingSchema.index({ userId: 1 });
turfBookingSchema.index({ turfId: 1 });
turfBookingSchema.index({ status: 1 });
turfBookingSchema.index({ date: 1 });
turfBookingSchema.index({ "sport.name": 1 });

module.exports = mongoose.model("TurfBooking", turfBookingSchema);
