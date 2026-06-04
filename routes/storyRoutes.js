const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/authMiddleware");
const { uploadMiddleware } = require("../middleware/uploads");
const ctrl = require("../controllers/storyController");

// Create — accepts either multipart (with `storyImage` file) or JSON text body.
router.post("/", authenticate, uploadMiddleware.single("storyImage"), ctrl.createStory);

// Current user's active stories (< 24h).
router.get("/mine", authenticate, ctrl.getMyStories);

// Active stories from everyone else, grouped by user.
router.get("/feed", authenticate, ctrl.getStoriesFeed);

// Record a view.
router.post("/:id/view", authenticate, ctrl.markViewed);

// Delete a story (owner only).
router.delete("/:id", authenticate, ctrl.deleteStory);

module.exports = router;
