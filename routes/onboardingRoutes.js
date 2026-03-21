const express = require("express");
const router = express.Router();
const onboardingController = require("../controllers/onboardingController");

// Check onboarding status (deviceId required, userId optional)
router.get("/status", onboardingController.checkStatus);

// Track screen view (analytics)
router.post("/track-screen", onboardingController.trackScreen);

// Update step progress
router.post("/update-step", onboardingController.updateStep);

// Update user preferences
router.post("/update-preferences", onboardingController.updatePreferences);

// Complete onboarding
router.post("/complete", onboardingController.completeOnboarding);

// Skip onboarding
router.post("/skip", onboardingController.skipOnboarding);

// Reset onboarding (for testing/admin)
router.post("/reset", onboardingController.resetOnboarding);

module.exports = router;
