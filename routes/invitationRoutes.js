const express = require("express");
const router = express.Router();
const invitationController = require("../controllers/invitationController");
const { authenticate } = require("../middleware/authMiddleware");
const { requireSelf, requireOwner, forceSelfBody } = require("../middleware/authz");

// Send invitation — sender_id is forced to the caller (can't send "as" someone else)
router.post("/send", authenticate, forceSelfBody("sender_id"), invitationController.send);

// Starter list of players to invite (static path — before any /:param routes)
router.get("/default-players", authenticate, invitationController.getDefaultPlayers);

// Respond to invitation — only the invitation's receiver may accept/reject it
router.post(
  "/respond",
  authenticate,
  requireOwner({ model: "Invitation", ownerField: "receiverId", idBody: "invitation_id" }),
  invitationController.respond
);

// Get received invitations
router.get("/received/:playerId", authenticate, requireSelf("playerId"), invitationController.getReceived);

// Get sent invitations
router.get("/sent/:playerId", authenticate, requireSelf("playerId"), invitationController.getSent);

// Get pending count (for badge)
router.get(
  "/pending-count/:playerId",
  authenticate,
  requireSelf("playerId"),
  invitationController.getPendingCount
);

// Get invitations for a tournament (manager/organizer view). Requires auth
// (Phase 3 / 1B). No mobile or web caller today, so this is zero-regression.
router.get("/tournament/:tournamentId", authenticate, invitationController.getByTournament);

module.exports = router;
