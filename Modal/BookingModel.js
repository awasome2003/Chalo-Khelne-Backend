const mongoose = require("mongoose");

const BookingSchema = new mongoose.Schema(
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
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
    },
    tournamentName: {
      type: String,
      required: true,
    },
    tournamentType: {
      type: String,
      required: true,
      lowercase: true,
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "cancelled"],
      default: "pending",
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "waived"],
      default: "pending",
    },
    paymentAmount: {
      type: Number,
      default: 0,
    },
    paymentMethod: {
      type: String,
      default: "cash", // Default to offline/cash
      enum: ["cash", "online"], // ✅ Only two methods allowed
      lowercase: true,
    },
    cancellationReason: String,
    cancellationDate: Date,
    team: {
      name: String,
      // Legacy positions (A/B/C) — kept for backward compatibility
      positions: {
        A: String, // Captain
        B: String, // First Player
        C: String, // Second Player
      },
      captain: {
        name: String,
        id: String,
        profileImage: String,
      },
      players: [
        {
          name: String,
          id: String,
          profileImage: String,
        },
      ],
      substitutes: [
        {
          name: String,
          id: String,
          profileImage: String,
        },
      ],
      // Multi-sport roster — flexible player list for any team size
      roster: [{
        userId: String,
        name: String,
        role: { type: String, enum: ["captain", "player", "substitute"], default: "player" },
        position: String, // Sport-specific position
        profileImage: String,
      }],
      teamSize: Number, // Expected team size for this sport
    },
    selectedCategories: [
      {
        id: String,
        name: String,
        price: Number,
        gender: String,
        ageCategory: String,
      },
    ],
    employeeId: {
      type: String,
    },
    // Sport-specific booking data (dynamic fields per sport type)
    customFields: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Add index for better query performance
BookingSchema.index({ userId: 1 });
BookingSchema.index({ tournamentId: 1 });
BookingSchema.index({ status: 1 });

module.exports = mongoose.model("Booking", BookingSchema);
