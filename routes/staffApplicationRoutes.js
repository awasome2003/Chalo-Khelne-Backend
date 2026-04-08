const express = require("express");
const router = express.Router();
const controller = require("../controllers/staffApplicationController");

// ═══ Player-side (Mobile) ═══
router.post("/apply", controller.apply);
router.get("/my/:userId", controller.getMyApplications);
router.put("/:applicationId/withdraw", controller.withdraw);

// ═══ Manager-side (Web) ═══
router.get("/tournament/:tournamentId", controller.getByTournament);
router.get("/tournament/:tournamentId/accepted", controller.getAcceptedStaff);
router.get("/:applicationId/profile", controller.getApplicantProfile);
router.put("/:applicationId/accept", controller.accept);
router.put("/:applicationId/reject", controller.reject);
router.put("/:applicationId/verify", controller.verify);
router.get("/manager/:managerId/pending", controller.getManagerPending);

module.exports = router;
