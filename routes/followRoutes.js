const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/authMiddleware");
const ctrl = require("../controllers/followController");

// User search / discovery (defined before the /:userId routes)
router.get("/search", authenticate, ctrl.searchUsers);

// Follow / unfollow (toggle)
router.post("/:targetId/toggle", authenticate, ctrl.toggleFollow);

// Relationship status + counts for a user (relative to the caller)
router.get("/:userId/status", authenticate, ctrl.getStatus);

// Followers / following lists
router.get("/:userId/followers", authenticate, ctrl.getFollowers);
router.get("/:userId/following", authenticate, ctrl.getFollowing);

module.exports = router;
