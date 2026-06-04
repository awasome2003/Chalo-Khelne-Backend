const express = require("express");
const router = express.Router();
const turfController = require("../controllers/turfController");
const { uploadMiddleware } = require("../middleware/uploads");
const { managerAuth, allowUserOrManager, authenticate, requireSuperAdmin } = require("../middleware/authMiddleware");
const { requireSelf } = require("../middleware/authz");

// Get all turfs owned by the current user. allowUserOrManager so both Managers
// (their assigned turfs) and ClubAdmins (turfs they own) can list — the
// controller's getUserTurfs scopes by req.user.id, so each principal sees only
// what they should.
router.get("/owner", allowUserOrManager, turfController.getUserTurfs);

// Same data as /owner but the id is explicit in the path. allowUserOrManager
// for the same reason; requireSelf forces the param to equal the caller.
router.get("/assigned/:managerId", allowUserOrManager, requireSelf("managerId"), async (req, res) => {
  req.query.userId = req.params.managerId;
  return turfController.getUserTurfs(req, res);
});

// Get all turfs (with optional filtering)
router.get("/", turfController.getAllTurfs);

// Today's availability for every active turf — kept above the /:id route
// so Express doesn't capture "availability" as an id parameter.
router.get("/availability/today", turfController.getTodaysAvailability);

// SuperAdmin: turfs awaiting approval (kept above /:id so it isn't captured as an id)
router.get("/admin/pending", requireSuperAdmin, turfController.getPendingTurfs);

// Get a single turf by ID
router.get("/:id", turfController.getTurfById);

// Self-registration — any authenticated user registers their own turf (pending approval)
router.post(
  "/register",
  authenticate,
  uploadMiddleware.array("turfImages", 3),
  turfController.registerTurf
);

// Create a new turf (club/manager flow — auto-approved)
router.post(
  "/",
  managerAuth,
  uploadMiddleware.array("turfImages", 3), // Allow up to 3 images
  turfController.createTurf
);

// SuperAdmin: approve / unapprove a turf for the public marketplace
router.patch("/:id/approve", requireSuperAdmin, turfController.approveTurf);

// Update a turf
router.put(
  "/:id",
  managerAuth,
  uploadMiddleware.array("turfImages", 3),
  turfController.updateTurf
);

// Delete a turf
router.delete("/:id", managerAuth, turfController.deleteTurf);

// Add a review to a turf (any authenticated user or manager)
router.post("/:id/reviews", allowUserOrManager, turfController.addReview);

router.patch("/:id/toggle-status", managerAuth, turfController.toggleTurfStatus);

module.exports = router;
