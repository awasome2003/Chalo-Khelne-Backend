const express = require("express");
const router = express.Router();
const donationController = require("../controllers/donationController");
const { authenticate } = require("../middleware/authMiddleware");

// Authenticated routes (static paths first)
router.get("/my-listings", authenticate, donationController.getMyListings);
router.get("/my-claims", authenticate, donationController.getMyClaims);
router.post("/list", authenticate, donationController.createListing);
router.put("/list/:id", authenticate, donationController.updateListing);
router.delete("/list/:id", authenticate, donationController.withdrawListing);
router.post("/claim/:id", authenticate, donationController.claimItem);
router.post("/claim/:id/pay", authenticate, donationController.uploadPayment);
router.post("/claim/:id/verify", authenticate, donationController.verifyPayment);

// Public routes
router.get("/listings", donationController.getListings);

// Param route LAST
router.get("/listings/:id", donationController.getListingById);

module.exports = router;
