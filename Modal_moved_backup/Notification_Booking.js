const mongoose = require("mongoose");

const bookingNotificationSchema = new mongoose.Schema(
  {
    managerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Manager",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    turfId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Turf",
      required: true,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TurfBooking",
      required: true,
    },
    type: {
      type: String,
      enum: ["booking_new", "booking_cancel"],
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    turfName: String,
    sport: String,
    date: String,
    timeSlot: String,
    amount: Number,
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

bookingNotificationSchema.index({ managerId: 1, createdAt: -1 });
bookingNotificationSchema.index({ managerId: 1, isRead: 1 });

module.exports = mongoose.model("BookingNotification", bookingNotificationSchema);
