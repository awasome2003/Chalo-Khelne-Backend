// Trainer.js - Updated Model
const mongoose = require("mongoose");

const TrainerSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  firstName: {
    type: String,
    required: true,
  },
  lastName: {
    type: String,
    required: true,
  },
  dob: {
    type: Date,
  },
  gender: {
    type: String,
    enum: ["male", "female", "other"],
  },
  sports: [
    {
      type: String,
    },
  ],
  experience: {
    type: Number,
    default: 0,
  },
  experienceDescription: {
    type: String,
  },
  address: {
    type: String,
  },
  emergencyContact: {
    type: String,
  },
  emergencyContactName: {
    type: String,
  },
  bio: {
    type: String,
  },
  languages: [
    {
      type: String,
    },
  ],
  certificates: [
    {
      name: {
        type: String,
        required: true,
      },
      issuedBy: {
        type: String,
        required: true,
      },
      issueDate: {
        type: Date,
        required: true,
      },
      expiryDate: {
        type: Date,
      },
      certificateId: {
        type: String,
      },
      certificateUrl: {
        type: String,
      },
      createdAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5,
  },
  reviewCount: {
    type: Number,
    default: 0,
  },
  tags: [
    {
      type: String,
    },
  ],
  verifiedClubs: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Turf",
    },
  ],
  fees: {
    perSession: {
      type: Number,
      default: 0,
    },
    packages: [
      {
        name: {
          type: String,
        },
        description: {
          type: String,
        },
        price: {
          type: Number,
        },
        sessions: {
          type: Number,
        },
      },
    ],
  },
  sessionTypes: {
    personal: {
      type: Boolean,
      default: true,
    },
    group: {
      type: Boolean,
      default: false,
    },
    intermediate: {
      type: Boolean,
      default: false,
    },
  },
  availability: [
    {
      dayOfWeek: {
        type: Number, // 0-6 for Sunday-Saturday
        required: true,
      },
      timeSlots: [
        {
          startTime: String, // format "HH:MM"
          endTime: String, // format "HH:MM"
          type: {
            type: String,
            enum: ["Morning", "Afternoon", "Evening"],
          },
          _id: false,
        },
      ],
      _id: false,
    },
  ],
  profileImage: {
    type: String,
  },
  sessionDetails: [
    {
      type: String,
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Add indexes for efficient querying
TrainerSchema.index({ userId: 1 }, { unique: true });
TrainerSchema.index({ sports: 1 });
TrainerSchema.index({ rating: -1 });
TrainerSchema.index({ verifiedClubs: 1 });
TrainerSchema.index({ "fees.perSession": 1 });

// Update the updatedAt timestamp before saving
TrainerSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("Trainer", TrainerSchema);
