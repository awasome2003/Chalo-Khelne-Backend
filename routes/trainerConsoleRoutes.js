const express = require("express");
const router = express.Router();
const tc = require("../controllers/trainerConsoleController");
const { authenticate, allowUserOrManager } = require("../middleware/authMiddleware");
const { requireSelf, requireOwner, forceSelfBody } = require("../middleware/authz");

// Trainer identity (auto-creates a Trainer profile if missing)
router.get("/me/:userId", authenticate, requireSelf("userId"), tc.me);

// Dashboard
router.get("/dashboard/:userId", authenticate, requireSelf("userId"), tc.dashboard);

// Earnings
router.get("/earnings/:userId", authenticate, requireSelf("userId"), tc.earnings);

// Sessions
router.get("/sessions/:userId", authenticate, requireSelf("userId"), tc.listSessions);
router.post("/sessions", authenticate, forceSelfBody("userId"), tc.createSession);

// Batches
router.get("/batches/:userId", authenticate, requireSelf("userId"), tc.listBatches);
router.post("/batches", authenticate, forceSelfBody("userId"), tc.createBatch);

// Requests
router.get("/requests/:userId", authenticate, requireSelf("userId"), tc.listRequests);
router.patch(
  "/requests/player/:id/respond",
  authenticate,
  requireOwner({ model: "Request", ownerField: "trainerId", idParam: "id" }),
  tc.respondPlayerRequest
);
router.patch(
  "/requests/club/:id/respond",
  authenticate,
  requireOwner({ model: "ClubRequest", ownerField: "trainerId", idParam: "id" }),
  tc.respondClubRequest
);

// Clubs directory
router.get("/clubs", authenticate, tc.listClubs);
router.post("/clubs/apply", authenticate, forceSelfBody("userId"), tc.applyToClub);

// Schedule / Calendar feed — accepts User, Manager AND Substitute tokens.
// :userId is informational; the controller derives identity from req.user.
router.get("/calendar/:userId", allowUserOrManager, tc.getCalendar);

module.exports = router;
