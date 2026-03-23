const express = require("express");
const router = express.Router();
const invitationController = require("../controllers/invitationController");
const { authenticate } = require("../middleware/authMiddleware");

// Send invitation (authenticated player)
router.post("/send", authenticate, invitationController.send);

// Respond to invitation (authenticated player)
router.post("/respond", authenticate, invitationController.respond);

// Get received invitations
router.get("/received/:playerId", authenticate, invitationController.getReceived);

// Get sent invitations
router.get("/sent/:playerId", authenticate, invitationController.getSent);

// Get pending count (for badge)
router.get("/pending-count/:playerId", authenticate, invitationController.getPendingCount);

// Get invitations for a tournament
router.get("/tournament/:tournamentId", invitationController.getByTournament);

module.exports = router;
