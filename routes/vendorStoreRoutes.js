const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/vendorStoreController");
const { authenticate, requireRole } = require("../middleware/authMiddleware");
const VendorProfile = require("../Modal/VendorProfile");

// Resolve the caller's vendor profile and require it to be THE platform vendor
// (the app-owner middleman who receives product uploads). Runs after
// authenticate + requireRole("vendor").
async function requirePlatformVendor(req, res, next) {
  try {
    const userId = req.user?.id || req.user?._id;
    const profile = await VendorProfile.findOne({ userId });
    if (!profile) return res.status(403).json({ success: false, message: "No vendor profile found" });
    if (!profile.isPlatformVendor) {
      return res.status(403).json({ success: false, message: "Only the platform vendor can manage incoming products." });
    }
    req.vendorProfile = profile;
    next();
  } catch (err) {
    next(err);
  }
}

const platformVendor = [authenticate, requireRole("vendor"), requirePlatformVendor];

// ── Platform vendor: review / acquire / publish ──
router.get("/incoming", ...platformVendor, ctrl.getIncoming);
router.get("/my-products", ...platformVendor, ctrl.getMyProducts);
router.get("/products/:id", ...platformVendor, ctrl.getProduct);
router.post("/products/:id/accept", ...platformVendor, ctrl.acceptProduct);
router.post("/products/:id/reject", ...platformVendor, ctrl.rejectProduct);
router.post("/products/:id/pickup", ...platformVendor, ctrl.markPickedUp);
router.post("/products/:id/publish", ...platformVendor, ctrl.publishProduct);

// ── Seller (listing owner): respond to the vendor's offer ──
router.post("/products/:id/offer-response", authenticate, ctrl.respondToOffer);

module.exports = router;
