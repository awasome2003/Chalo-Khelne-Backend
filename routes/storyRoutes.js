const express = require("express");
const router = express.Router();
const { allowUserOrManager } = require("../middleware/authMiddleware");
const { uploadMiddleware } = require("../middleware/uploads");
const ctrl = require("../controllers/storyController");

// Create — accepts either multipart (with `storyImage` file) or JSON text body.
router.post("/", allowUserOrManager, uploadMiddleware.single("storyImage"), ctrl.createStory);

// Current user's active stories (< 24h).
router.get("/mine", allowUserOrManager, ctrl.getMyStories);

// Active stories from everyone else, grouped by user.
router.get("/feed", allowUserOrManager, ctrl.getStoriesFeed);

// Record a view.
router.post("/:id/view", allowUserOrManager, ctrl.markViewed);

// Delete a story (owner only).
router.delete("/:id", allowUserOrManager, ctrl.deleteStory);

module.exports = router;
