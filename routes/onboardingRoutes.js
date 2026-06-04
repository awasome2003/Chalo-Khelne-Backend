const express = require("express");
const router = express.Router();
const onboardingController = require("../controllers/onboardingController");
const { requireSuperAdmin } = require("../middleware/authMiddleware");

// ──────────────────────────────────────────────────────────────────────────
// IMPORTANT: onboarding is DEVICE-based and runs BEFORE a user logs in
// (checkStatus requires a deviceId; userId is optional, for analytics only).
// Forcing authentication here would break first-run onboarding for brand-new /
// anonymous users — so these routes intentionally stay public. The data is
// keyed by deviceId and contains no sensitive PII.
// Only the destructive admin/testing route (/reset) is gated.
// ──────────────────────────────────────────────────────────────────────────

// Check onboarding status (deviceId required, userId optional) — public, pre-login
router.get("/status", onboardingController.checkStatus);

// Track screen view (analytics) — public, pre-login
router.post("/track-screen", onboardingController.trackScreen);

// Update step progress — public, pre-login
router.post("/update-step", onboardingController.updateStep);

// Update user preferences — public, pre-login
router.post("/update-preferences", onboardingController.updatePreferences);

// Complete onboarding — public, pre-login
router.post("/complete", onboardingController.completeOnboarding);

// Skip onboarding — public, pre-login
router.post("/skip", onboardingController.skipOnboarding);

// Reset onboarding (testing/admin only) — SuperAdmin gated
router.post("/reset", requireSuperAdmin, onboardingController.resetOnboarding);

module.exports = router;
