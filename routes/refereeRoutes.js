const express = require("express");
const router = express.Router();

// Import the controller for referee-related routes
const refereeController = require("../controllers/refereeController");

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
router.post("/certificate/:id", refereeController.addCertificate);
router.delete("/certificate/:id/:certId", refereeController.removeCertificate);
router.get("/assignments/:id", refereeController.getRefereeAssignments);
router.get("/assignments/completed/:id", refereeController.getCompletedAssignments);
router.put("/assignments/:id/:assignmentId/accept", refereeController.acceptAssignment);
router.put("/assignments/:id/:assignmentId/decline", refereeController.declineAssignment);
router.put("/availability/:id", refereeController.updateAvailability);
router.get("/stats/:id", refereeController.getRefereeStats);

// Referee request-related routes
router.get("/requests", getRequests);
router.get("/requests/:id", getRequestById);
router.post("/requests", createRequest);
router.put("/requests/:id/status", updateRequestStatus);


module.exports = router;
