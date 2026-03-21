const mongoose = require("mongoose");

const turfSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Turf name is required"],
      trim: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Turf owner is required"],
    },
    images: [String],
    address: {
      fullAddress: {
        type: String,
        required: [true, "Address is required"],
      },
      area: {
        type: String,
        required: [true, "Area is required"],
      },
      city: {
        type: String,
        required: [true, "City is required"],
      },
      pincode: {
        type: String,
        required: [true, "Pincode is required"],
      },
      coordinates: {
        lat: Number,
        lng: Number,
      },
    },
    sports: [
      {
        name: {
          type: String,
          required: true,
        },
        pricePerHour: {
          type: Number,
          default: 0,
        },
      },
    ],
    assignedManagers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Manager",
      },
    ],
    clubName: {
      type: String,
      required: false,
      trim: true,
    },
    razorpayAccountId: {
      type: String,
      required: false,
    },
    facilities: {
      artificialTurf: { type: Boolean, default: false },
      multipleFields: { type: Boolean, default: false },
      floodLights: { type: Boolean, default: false },
      ledLights: { type: Boolean, default: false },
      lockerRooms: { type: Boolean, default: false },
      shower: { type: Boolean, default: false },
      restrooms: { type: Boolean, default: false },
      grandstands: { type: Boolean, default: false },
      coveredAreas: { type: Boolean, default: false },
      parking: { type: Boolean, default: false },
      foodCourt: { type: Boolean, default: false },
      coldDrinks: { type: Boolean, default: false },
      drinkingWater: { type: Boolean, default: false },
      wifi: { type: Boolean, default: false },
      loungeArea: { type: Boolean, default: false },
      surveillanceCameras: { type: Boolean, default: false },
      securityPersonnel: { type: Boolean, default: false },
      firstAidKit: { type: Boolean, default: false },
    },
    description: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // For scheduling and availability
    availableTimeSlots: [
      {
        day: {
          type: String,
          enum: [
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
          ],
        },
        startTime: String,
        endTime: String,
      },
    ],
    // For reviews and ratings
    ratings: {
      average: {
        type: Number,
        default: 0,
      },
      count: {
        type: Number,
        default: 0,
      },
    },
    reviews: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        rating: Number,
        comment: String,
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Create indexes for efficient queries
turfSchema.index({ "address.city": 1 });
turfSchema.index({ "address.area": 1 });
turfSchema.index({ "address.pincode": 1 });
turfSchema.index({ "sports.name": 1 });
turfSchema.index({ owner: 1 });
turfSchema.index({ isActive: 1, isApproved: 1 });

const Turf = mongoose.model("Turf", turfSchema);

module.exports = Turf;
