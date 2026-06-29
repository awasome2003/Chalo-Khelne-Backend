const express = require("express");
const router = express.Router();
const { allowUserOrManager } = require("../middleware/authMiddleware");
const ctrl = require("../controllers/followController");

// User search / discovery (defined before the /:userId routes)
router.get("/search", allowUserOrManager, ctrl.searchUsers);

// Follow / unfollow (toggle)
router.post("/:targetId/toggle", allowUserOrManager, ctrl.toggleFollow);

// Relationship status + counts for a user (relative to the caller)
router.get("/:userId/status", allowUserOrManager, ctrl.getStatus);

// Followers / following lists
router.get("/:userId/followers", allowUserOrManager, ctrl.getFollowers);
router.get("/:userId/following", allowUserOrManager, ctrl.getFollowing);

module.exports = router;
