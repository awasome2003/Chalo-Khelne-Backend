const express = require("express");
const router = express.Router();
const turfController = require("../controllers/turfController");
const { uploadMiddleware } = require("../middleware/uploads");

// Get all turfs owned by the current user
router.get("/owner", turfController.getUserTurfs);

// Get all turfs (with optional filtering)
router.get("/", turfController.getAllTurfs);

// Get a single turf by ID
router.get("/:id", turfController.getTurfById);

// Create a new turf
router.post(
  "/",
  uploadMiddleware.array("turfImages", 3), // Allow up to 3 images
  turfController.createTurf
);

// Update a turf
router.put(
  "/:id",
  uploadMiddleware.array("turfImages", 3),
  turfController.updateTurf
);

// Delete a turf
router.delete("/:id", turfController.deleteTurf);

// Add a review to a turf
router.post("/:id/reviews", turfController.addReview);

router.patch("/:id/toggle-status", turfController.toggleTurfStatus);

module.exports = router;
