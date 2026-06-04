const express = require("express");
const router = express.Router();
const controller = require("../controllers/staffApplicationController");
const { authenticate, managerAuth } = require("../middleware/authMiddleware");
const { requireSelf, requireOwner, forceSelfBody } = require("../middleware/authz");

// ═══ Player-side (Mobile) ═══
// apply forces the applicant to the caller; reads/withdraw are ownership-checked.
router.post("/apply", authenticate, forceSelfBody("userId"), controller.apply);
router.get("/my/:userId", authenticate, requireSelf("userId"), controller.getMyApplications);
router.put(
  "/:applicationId/withdraw",
  authenticate,
  requireOwner({ model: "StaffApplication", ownerField: "userId", idParam: "applicationId" }),
  controller.withdraw
);

// ═══ Manager-side (Web) ═══ — manager token required
router.get("/tournament/:tournamentId", managerAuth, controller.getByTournament);
router.get("/tournament/:tournamentId/accepted", managerAuth, controller.getAcceptedStaff);
router.get("/:applicationId/profile", managerAuth, controller.getApplicantProfile);
// accept/reject/verify: only the manager who owns the application (its tournament) may act.
router.put(
  "/:applicationId/accept",
  managerAuth,
  requireOwner({ model: "StaffApplication", ownerField: "managerId", idParam: "applicationId" }),
  controller.accept
);
router.put(
  "/:applicationId/reject",
  managerAuth,
  requireOwner({ model: "StaffApplication", ownerField: "managerId", idParam: "applicationId" }),
  controller.reject
);
router.put(
  "/:applicationId/verify",
  managerAuth,
  requireOwner({ model: "StaffApplication", ownerField: "managerId", idParam: "applicationId" }),
  controller.verify
);
router.get("/manager/:managerId/pending", managerAuth, requireSelf("managerId"), controller.getManagerPending);

module.exports = router;
