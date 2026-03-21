const express = require("express");
const router = express.Router();
const trainerController = require("../controllers/trainerController");
const { uploadMiddleware } = require("../middleware/uploads");

// Public routes
router.get("/trainers", trainerController.getAllTrainers);
router.get("/trainer/:id", trainerController.getTrainerById);
router.get("/profile/:id", trainerController.getTrainerProfile);
router.get("/sessions/:id", trainerController.getTrainerSessions);
router.get("/session/:id", trainerController.getSessionById);
router.get("/verified-clubs/:id", trainerController.getVerifiedClubs);

// Profile image upload
router.post(
  "/profile/:id/image",
  uploadMiddleware.single("profileImage"),
  trainerController.uploadProfileImage
);

// Certificate management
router.post(
  "/certificate/:id",
  uploadMiddleware.single("certificate"),
  trainerController.addCertificate
);
router.delete("/certificate/:id/:certId", trainerController.removeCertificate);

// Routes for session management
router.post("/sessions", trainerController.createSession);
router.put("/sessions/:id", trainerController.updateSession);
router.delete("/sessions/:id", trainerController.deleteSession);
router.get("/requests/:id", trainerController.getTrainingRequests);
router.put("/requests/:id/accept", trainerController.acceptRequest);
router.put("/requests/:id/reject", trainerController.rejectRequest);

// Profile updates
router.put("/profile/:id", trainerController.updateTrainerProfile);
router.post("/availability/:id", trainerController.updateAvailability);
router.post("/fees/:id", trainerController.updateFees);
router.post("/session-types/:id", trainerController.updateSessionTypes);
router.post("/feedback/:sessionId", trainerController.addSessionFeedback);

// Enhanced session requests
router.get("/my-training/:userId", trainerController.getMyTrainingSessions);
router.post("/request-session", trainerController.requestSession);
router.post("/join-session", trainerController.requestJoinSession);
router.get(
  "/session-requests/:id",
  trainerController.getTrainerSessionRequests
);
router.put("/cancel-request/:id", trainerController.cancelRequest);
router.get("/request-status/:requestId", trainerController.getRequestStatus);

// Session types
router.get("/session-types", trainerController.getSessionTypes);
router.get("/session-types/:id", trainerController.getSessionTypes);

//Club Application Routes
router.post("/apply-to-club", trainerController.applyToClub);
router.get(
  "/club-applications/:trainerId",
  trainerController.getMyClubApplications
);
router.get(
  "/application-status/:trainerId/:turfId",
  trainerController.checkApplicationStatus
);
router.delete(
  "/cancel-application/:applicationId",
  trainerController.cancelApplication
);
router.get(
  "/certified-trainers/:turfId",
  trainerController.getCertifiedTrainers
);

module.exports = router;
