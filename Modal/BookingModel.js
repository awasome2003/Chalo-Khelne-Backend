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
      enum: [
        "Team Knockouts",
        "Group Stage",
        "Single Elimination",
        "Double Elimination",
        "Round Robin",
        "knockout",
        "group stage"
      ],
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
      positions: {
        A: String, // Captain
        B: String, // First Player
        C: String, // Second Player
      },
      captain: {
        name: String,
        id: String,
        profileImage: String, // Captain Profile Image
      },
      players: [
        {
          name: String,
          id: String,
          profileImage: String, // Player Profile Image
        },
      ],
      substitutes: [
        {
          name: String,
          id: String,
          profileImage: String, // Substitute Profile Image
        },
      ],
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
