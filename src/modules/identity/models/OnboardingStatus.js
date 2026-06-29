const mongoose = require("mongoose");

const onboardingStatusSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true, // ALWAYS required - primary identifier
      unique: true, // One onboarding per device
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false, // Optional - stores which user last logged in on this device
      default: null,
    },

    hasCompletedOnboarding: {
      type: Boolean,
      default: false,
    },

    onboardingVersion: {
      type: String,
      default: "1.0", // Track version in case we update onboarding
    },

    completedSteps: [
      {
        stepName: {
          type: String,
          required: true,
        },
        completedAt: {
          type: Date,
          default: Date.now,
        },
        timeSpent: {
          type: Number, // Time spent in seconds
          default: 0,
        },
      },
    ],

    skippedAt: {
      type: Date,
      default: null, // If user skipped onboarding
    },

    completedAt: {
      type: Date,
      default: null,
    },

    userRole: {
      type: String,
      enum: ["Player", "Trainer", "Referee", "Viewer"],
      default: "Viewer", // Default to Viewer for anonymous users
    },

    // User preferences collected during onboarding
    preferences: {
      selectedSports: [
        {
          type: String,
          enum: ["table-tennis", "cricket", "football", "badminton", "tennis"],
        },
      ],
      notificationsEnabled: {
        type: Boolean,
        default: false,
      },
      locationEnabled: {
        type: Boolean,
        default: false,
      },
    },

    // Analytics - track which screens were viewed
    viewedScreens: [
      {
        screenName: {
          type: String,
          required: true,
        },
        viewedAt: {
          type: Date,
          default: Date.now,
        },
        timeSpent: {
          type: Number, // Time in seconds
          default: 0,
        },
      },
    ],

    // Device info for analytics
    deviceInfo: {
      platform: String, // "ios" or "android"
      appVersion: String,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  }
);

// Regular indexes for queries
onboardingStatusSchema.index({ userId: 1 });
onboardingStatusSchema.index({ hasCompletedOnboarding: 1 });

module.exports = mongoose.model("OnboardingStatus", onboardingStatusSchema);
