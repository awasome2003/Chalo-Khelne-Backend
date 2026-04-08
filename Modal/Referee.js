const mongoose = require("mongoose");

const RefereeSchema = new mongoose.Schema({
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
    default: "",
  },
  dob: {
    type: Date,
  },
  gender: {
    type: String,
    enum: ["male", "female", "other"],
  },
  sport: {
    type: String,
  },
  sports: {
    type: [String],
    default: ["table-tennis"],
  },
  experience: {
    type: Number,
    default: 0,
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
  about: {
    type: String,
  },
  certificationLevel: {
    type: String,
    enum: ["Level 1", "Level 2", "Level 3", "International"],
    default: "Level 1",
  },
  certificates: [
    {
      name: {
        type: String,
        default: "Document",
      },
      issuedBy: {
        type: String,
        default: "",
      },
      issueDate: {
        type: Date,
        default: null,
      },
      expiryDate: {
        type: Date,
      },
      certificateId: {
        type: String,
      },
      certificateUrl: {
        type: String,
        default: null,
      },
      createdAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  availableDays: {
    type: [String],
    enum: [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ],
    default: [],
  },
  availableTimeSlots: [
    {
      day: {
        type: String,
        enum: [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday",
        ],
      },
      startTime: {
        type: String,
      },
      endTime: {
        type: String,
      },
    },
  ],
  ratings: [
    {
      value: {
        type: Number,
        min: 1,
        max: 5,
      },
      comment: {
        type: String,
      },
      givenBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      createdAt: {
        type: Date,
        default: Date.now,
      },
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

// Update the timestamp when document is updated
RefereeSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("Referee", RefereeSchema);
