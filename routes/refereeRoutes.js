const express = require("express");
const router = express.Router();

// Import the controller for referee-related routes
const refereeController = require("../controllers/refereeController");
const { uploadMiddleware } = require("../middleware/uploads");

// Import the controller for referee request-related routes
const {
  getRequests,
  getRequestById,
  createRequest,
  updateRequestStatus
} = require("../controllers/refreerequestController");

// Public routes (no auth required)
router.get("/referees", refereeController.getAllReferees);
router.get("/profile/:id", refereeController.getRefereeProfile);

// Protected routes (auth required)
router.put("/profile/:id", refereeController.updateRefereeProfile);
router.post("/certificate/:id", (req, res, next) => {
  uploadMiddleware.single("certificate")(req, res, (err) => {
    if (err) {
      console.error("[CERT_UPLOAD_REF] Multer error:", err.message);
      return res.status(400).json({ success: false, message: `Upload failed: ${err.message}` });
    }
    next();
  });
}, refereeController.addCertificate);
router.delete("/certificate/:id/:certId", refereeController.removeCertificate);
router.get("/assignments/:id", refereeController.getRefereeAssignments);
router.get("/assignments/completed/:id", refereeController.getCompletedAssignments);
router.put("/assignments/:id/:assignmentId/accept", refereeController.acceptAssignment);
router.put("/assignments/:id/:assignmentId/decline", refereeController.declineAssignment);
router.get("/applicants/:tournamentId", refereeController.getTournamentApplicants);
router.post("/assign-match/:matchId", refereeController.assignUmpireToMatch);
router.get("/my-authorizations/:userId/:tournamentId", refereeController.getMyAuthorizations);
router.put("/availability/:id", refereeController.updateAvailability);
router.get("/stats/:id", refereeController.getRefereeStats);

// Referee request-related routes
router.get("/requests", getRequests);
router.get("/requests/:id", getRequestById);
router.post("/requests", createRequest);
router.put("/requests/:id/status", updateRequestStatus);


module.exports = router;
