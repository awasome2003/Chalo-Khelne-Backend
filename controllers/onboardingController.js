const OnboardingStatus = require("../Modal/OnboardingStatus");
const User = require("../Modal/User");

const onboardingController = {
  // Check if device has completed onboarding (regardless of user)
  checkStatus: async (req, res) => {
    try {
      const { deviceId } = req.query; // deviceId is now ALWAYS required
      const { userId } = req.query; // userId is optional (for analytics)

      if (!deviceId) {
        return res.status(400).json({
          success: false,
          message: "Device ID is required",
        });
      }

      let userRole = "Viewer"; // Default for viewers

      // If userId provided, get user role and update the record
      if (userId) {
        try {
          const user = await User.findById(userId);
          if (user) {
            userRole = user.role;
          }
        } catch (error) {
          console.log("User not found, treating as viewer");
        }
      }

      // Find or create onboarding status BY DEVICE ID ONLY
      let onboardingStatus = await OnboardingStatus.findOne({ deviceId });

      if (!onboardingStatus) {
        // Create new onboarding status for this device
        try {
          onboardingStatus = new OnboardingStatus({
            deviceId,
            userId: userId || null,
            userRole,
            hasCompletedOnboarding: false,
          });
          await onboardingStatus.save();
        } catch (saveError) {
          console.error("Error saving new onboarding status:", saveError);
          // Even if save fails, continue with a temporary in-memory object
          onboardingStatus = {
            deviceId,
            userId: userId || null,
            userRole,
            hasCompletedOnboarding: false,
            onboardingVersion: "1.0",
            preferences: {}
          };
        }
      } else if (userId && onboardingStatus.userId && onboardingStatus.userId.toString() !== userId) {
        // Device exists but different user logged in - update userId
        try {
          onboardingStatus.userId = userId;
          onboardingStatus.userRole = userRole;
          await onboardingStatus.save();
        } catch (updateError) {
          console.error("Error updating onboarding status:", updateError);
          // Continue with existing data if update fails
        }
      }

      return res.status(200).json({
        success: true,
        hasCompleted: onboardingStatus.hasCompletedOnboarding,
        version: onboardingStatus.onboardingVersion,
        userRole: onboardingStatus.userRole,
        preferences: onboardingStatus.preferences,
      });
    } catch (error) {
      console.error("Error checking onboarding status:", error);
      // Return more detailed error information
      return res.status(500).json({
        success: false,
        message: "Error checking onboarding status",
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  },

  // Track screen view
  trackScreen: async (req, res) => {
    try {
      const { deviceId, screenName, timeSpent } = req.body;

      if (!deviceId || !screenName) {
        return res.status(400).json({
          success: false,
          message: "Device ID and screen name are required",
        });
      }

      const onboardingStatus = await OnboardingStatus.findOne({ deviceId });

      if (!onboardingStatus) {
        return res.status(404).json({
          success: false,
          message: "Onboarding status not found",
        });
      }

      // Add screen view to analytics
      onboardingStatus.viewedScreens.push({
        screenName,
        viewedAt: new Date(),
        timeSpent: timeSpent || 0,
      });

      await onboardingStatus.save();

      return res.status(200).json({
        success: true,
        message: "Screen view tracked",
      });
    } catch (error) {
      console.error("Error tracking screen:", error);
      return res.status(500).json({
        success: false,
        message: "Error tracking screen",
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  },

  // Update step progress
  updateStep: async (req, res) => {
    try {
      const { deviceId, stepName, timeSpent } = req.body;

      if (!deviceId || !stepName) {
        return res.status(400).json({
          success: false,
          message: "Device ID and step name are required",
        });
      }

      const onboardingStatus = await OnboardingStatus.findOne({ deviceId });

      if (!onboardingStatus) {
        return res.status(404).json({
          success: false,
          message: "Onboarding status not found",
        });
      }

      // Check if step already completed
      const stepExists = onboardingStatus.completedSteps.find(
        (step) => step.stepName === stepName
      );

      if (!stepExists) {
        onboardingStatus.completedSteps.push({
          stepName,
          completedAt: new Date(),
          timeSpent: timeSpent || 0,
        });
        await onboardingStatus.save();
      }

      return res.status(200).json({
        success: true,
        message: "Step updated successfully",
        completedSteps: onboardingStatus.completedSteps.length,
      });
    } catch (error) {
      console.error("Error updating step:", error);
      return res.status(500).json({
        success: false,
        message: "Error updating step",
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  },

  // Update preferences
  updatePreferences: async (req, res) => {
    try {
      const { deviceId, preferences } = req.body;

      if (!deviceId || !preferences) {
        return res.status(400).json({
          success: false,
          message: "Device ID and preferences are required",
        });
      }

      const onboardingStatus = await OnboardingStatus.findOne({ deviceId });

      if (!onboardingStatus) {
        return res.status(404).json({
          success: false,
          message: "Onboarding status not found",
        });
      }

      // Update preferences
      onboardingStatus.preferences = {
        ...onboardingStatus.preferences,
        ...preferences,
      };

      await onboardingStatus.save();

      return res.status(200).json({
        success: true,
        message: "Preferences updated successfully",
        preferences: onboardingStatus.preferences,
      });
    } catch (error) {
      console.error("Error updating preferences:", error);
      return res.status(500).json({
        success: false,
        message: "Error updating preferences",
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  },

  // Complete onboarding
  completeOnboarding: async (req, res) => {
    try {
      const { deviceId, deviceInfo } = req.body;

      if (!deviceId) {
        return res.status(400).json({
          success: false,
          message: "Device ID is required",
        });
      }

      const onboardingStatus = await OnboardingStatus.findOne({ deviceId });

      if (!onboardingStatus) {
        return res.status(404).json({
          success: false,
          message: "Onboarding status not found",
        });
      }

      // Mark as completed
      onboardingStatus.hasCompletedOnboarding = true;
      onboardingStatus.completedAt = new Date();

      if (deviceInfo) {
        onboardingStatus.deviceInfo = deviceInfo;
      }

      await onboardingStatus.save();

      return res.status(200).json({
        success: true,
        message: "Onboarding completed successfully",
        completedAt: onboardingStatus.completedAt,
      });
    } catch (error) {
      console.error("Error completing onboarding:", error);
      return res.status(500).json({
        success: false,
        message: "Error completing onboarding",
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  },

  // Skip onboarding
  skipOnboarding: async (req, res) => {
    try {
      const { deviceId } = req.body;

      if (!deviceId) {
        return res.status(400).json({
          success: false,
          message: "Device ID is required",
        });
      }

      const onboardingStatus = await OnboardingStatus.findOne({ deviceId });

      if (!onboardingStatus) {
        return res.status(404).json({
          success: false,
          message: "Onboarding status not found",
        });
      }

      // Mark as completed and skipped
      onboardingStatus.hasCompletedOnboarding = true;
      onboardingStatus.skippedAt = new Date();
      onboardingStatus.completedAt = new Date();

      await onboardingStatus.save();

      return res.status(200).json({
        success: true,
        message: "Onboarding skipped successfully",
      });
    } catch (error) {
      console.error("Error skipping onboarding:", error);
      return res.status(500).json({
        success: false,
        message: "Error skipping onboarding",
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  },

  // Reset onboarding (for testing/admin purposes)
  resetOnboarding: async (req, res) => {
    try {
      const { deviceId } = req.body;

      if (!deviceId) {
        return res.status(400).json({
          success: false,
          message: "Device ID is required",
        });
      }

      const result = await OnboardingStatus.findOneAndDelete({ deviceId });

      if (!result) {
        return res.status(404).json({
          success: false,
          message: "Onboarding status not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Onboarding reset successfully",
      });
    } catch (error) {
      console.error("Error resetting onboarding:", error);
      return res.status(500).json({
        success: false,
        message: "Error resetting onboarding",
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  },
};

module.exports = onboardingController;
