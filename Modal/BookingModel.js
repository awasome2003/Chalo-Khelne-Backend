const mongoose = require("mongoose");

const BookingSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
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
    // true when booking was created via manager's bulk upload (no user account)
    isGuestBooking: {
      type: Boolean,
      default: false,
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
    // STEP 17e — `selectedCategories` field declaration removed.
    // sportSelections is the canonical shape; legacy values on existing
    // docs persist until 17g $unset.
    //
    // (sport, category) pairs the player signed up for. Each pair is a
    // separate fee entry.
    sportSelections: [{
      sportId:      { type: mongoose.Schema.Types.ObjectId, ref: "Sport", required: true },
      sportName:    { type: String },
      categoryName: { type: String },
      fee:          { type: Number, default: 0 },
    }],
    // Total across all sportSelections (plus any other charges). Set by
    // the booking controller; falls back to paymentAmount for legacy
    // bookings.
    totalFee: { type: Number, default: 0 },
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
