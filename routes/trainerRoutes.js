const express = require("express");
const router = express.Router();
const trainerController = require("../controllers/trainerController");
const { uploadMiddleware } = require("../middleware/uploads");
const { authenticate } = require("../middleware/authMiddleware");
const { requireSelf, requireOwner, requireTrainerOwns } = require("../middleware/authz");

// Public routes (trainer discovery)
router.get("/trainers", trainerController.getAllTrainers);
router.get("/trainer/:id", trainerController.getTrainerById);
router.get("/profile/:id", trainerController.getTrainerProfile);
router.get("/sessions/:id", trainerController.getTrainerSessions);
router.get("/session/:id", trainerController.getSessionById);
router.get("/verified-clubs/:id", trainerController.getVerifiedClubs);

// Profile image upload (owner only — :id is the trainer's userId)
router.post(
  "/profile/:id/image",
  authenticate,
  requireSelf("id"),
  uploadMiddleware.single("profileImage"),
  trainerController.uploadProfileImage
);

// Certificate management (owner only — :id is the trainer's userId)
router.post(
  "/certificate/:id",
  authenticate,
  requireSelf("id"),
  (req, res, next) => {
    uploadMiddleware.single("certificate")(req, res, (err) => {
      if (err) {
        console.error("[CERT_UPLOAD] Multer error:", err.message, "| Code:", err.code);
        return res.status(400).json({ success: false, message: `Upload failed: ${err.message}` });
      }
      next();
    });
  },
  trainerController.addCertificate
);
router.delete("/certificate/:id/:certId", authenticate, requireSelf("id"), trainerController.removeCertificate);

// Routes for session management (authenticated; ownership enforced in controller)
router.post("/sessions", authenticate, trainerController.createSession);
router.put("/sessions/:id", authenticate, requireTrainerOwns({ model: "Session", ownerField: "trainerId", idParam: "id" }), trainerController.updateSession);
router.delete("/sessions/:id", authenticate, requireTrainerOwns({ model: "Session", ownerField: "trainerId", idParam: "id" }), trainerController.deleteSession);
router.get("/requests/:id", authenticate, trainerController.getTrainingRequests);
router.put("/requests/:id/accept", authenticate, requireOwner({ model: "Request", ownerField: "trainerId", idParam: "id" }), trainerController.acceptRequest);
router.put("/requests/:id/reject", authenticate, requireOwner({ model: "Request", ownerField: "trainerId", idParam: "id" }), trainerController.rejectRequest);

// Profile updates (owner only — :id is the trainer's userId)
router.put("/profile/:id", authenticate, requireSelf("id"), trainerController.updateTrainerProfile);
router.post("/availability/:id", authenticate, requireSelf("id"), trainerController.updateAvailability);
router.post("/fees/:id", authenticate, requireSelf("id"), trainerController.updateFees);
router.post("/session-types/:id", authenticate, requireSelf("id"), trainerController.updateSessionTypes);
router.post("/feedback/:sessionId", authenticate, trainerController.addSessionFeedback);

// Enhanced session requests
router.get("/my-training/:userId", authenticate, requireSelf("userId"), trainerController.getMyTrainingSessions);
router.post("/request-session", authenticate, trainerController.requestSession);
router.post("/join-session", authenticate, trainerController.requestJoinSession);
router.get(
  "/session-requests/:id",
  authenticate,
  trainerController.getTrainerSessionRequests
);
router.put("/cancel-request/:id", authenticate, trainerController.cancelRequest);
router.get("/request-status/:requestId", authenticate, trainerController.getRequestStatus);

// Session types (public)
router.get("/session-types", trainerController.getSessionTypes);
router.get("/session-types/:id", trainerController.getSessionTypes);

//Club Application Routes (authenticated)
router.post("/apply-to-club", authenticate, trainerController.applyToClub);
router.get(
  "/club-applications/:trainerId",
  authenticate,
  trainerController.getMyClubApplications
);
router.get(
  "/application-status/:trainerId/:turfId",
  authenticate,
  trainerController.checkApplicationStatus
);
router.delete(
  "/cancel-application/:applicationId",
  authenticate,
  trainerController.cancelApplication
);
router.get(
  "/certified-trainers/:turfId",
  trainerController.getCertifiedTrainers
);

module.exports = router;
