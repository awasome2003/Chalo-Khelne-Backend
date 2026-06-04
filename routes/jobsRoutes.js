const express = require("express");
const router = express.Router();
const jobs = require("../controllers/jobsController");
const { authenticate, allowUserOrManager } = require("../middleware/authMiddleware");
const { requireSelf, requireOwner, forceSelfBody } = require("../middleware/authz");

// ── Job postings (browse) — not user-scoped, any authenticated user ──
router.get("/postings", authenticate, jobs.listJobs);
router.get("/postings/:id", authenticate, jobs.getJob);

// ── Applications ──
// applicantId is forced to the caller so you can't apply "as" another user.
router.post("/applications", authenticate, forceSelfBody("applicantId"), jobs.apply);
router.get("/applications/my/:userId", authenticate, requireSelf("userId"), jobs.getMyApplications);

// ── Professional directory (hire) — static path before /:id routes ──
// allowUserOrManager so Manager-collection tokens can browse the directory
// from /mrefree (HireReferees). Matches the auth on /profiles/:id and
// /hire-requests/* which Manager also calls.
router.get("/professionals", allowUserOrManager, jobs.listProfessionals);

// ── Professional profiles ──
router.post("/profiles", authenticate, forceSelfBody("userId"), jobs.createProfile);
router.get("/profiles/my/:userId", authenticate, requireSelf("userId"), jobs.getMyProfiles);
router.patch(
  "/profiles/:id/active",
  authenticate,
  requireOwner({ model: "ProfessionalProfile", ownerField: "userId", idParam: "id" }),
  jobs.setProfileActive
);
// getProfile is a public-within-app read (you view a pro's profile to hire them).
// allowUserOrManager so a Manager-collection token can open a pro's profile from the hire inbox.
router.get("/profiles/:id", allowUserOrManager, jobs.getProfile);

// ── Hire requests ──
router.post("/hire-requests", allowUserOrManager, forceSelfBody("fromUserId"), jobs.sendHireRequest);
router.get(
  "/hire-requests/received/:userId",
  allowUserOrManager,
  requireSelf("userId"),
  jobs.getReceivedRequests
);
router.patch(
  "/hire-requests/:id/respond",
  allowUserOrManager,
  requireOwner({ model: "HireRequest", ownerField: "toUserId", idParam: "id" }),
  jobs.respondHireRequest
);

// ── Professional dashboard (derived stats + engagements) ──
router.get("/dashboard/:userId", authenticate, requireSelf("userId"), jobs.getDashboard);

module.exports = router;
