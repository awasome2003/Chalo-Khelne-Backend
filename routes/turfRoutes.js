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

// Create a new turf (club/manager flow — auto-approved).
// allowUserOrManager so BOTH a ClubAdmin (a User) and a club Manager can add a
// turf — managerAuth alone rejected ClubAdmins with 401. The owner is taken
// from the body's ownerId by the controller.
router.post(
  "/",
  allowUserOrManager,
  uploadMiddleware.array("turfImages", 3), // Allow up to 3 images
  turfController.createTurf
);

// SuperAdmin: approve / unapprove a turf for the public marketplace
router.patch("/:id/approve", requireSuperAdmin, turfController.approveTurf);

// Update a turf. allowUserOrManager (ClubAdmin or Manager); the controller
// authorizes the caller against the turf owner via callerOwnsTurf().
router.put(
  "/:id",
  allowUserOrManager,
  uploadMiddleware.array("turfImages", 3),
  turfController.updateTurf
);

// Delete a turf. allowUserOrManager — ownership verified by callerOwnsTurf().
router.delete("/:id", allowUserOrManager, turfController.deleteTurf);

// Add a review to a turf (any authenticated user or manager)
router.post("/:id/reviews", allowUserOrManager, turfController.addReview);

// Toggle active/inactive. allowUserOrManager — ownership verified in controller.
router.patch("/:id/toggle-status", allowUserOrManager, turfController.toggleTurfStatus);

// Assign / remove a manager on a turf (club owner manages turf staff). The
// controllers existed but were never routed → the frontend got 404s.
router.post("/:id/assign-manager", allowUserOrManager, turfController.assignManager);
router.delete("/:id/remove-manager/:managerId", allowUserOrManager, turfController.removeManager);

module.exports = router;
