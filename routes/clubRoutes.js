/**
 * Club OS (facility-business) routes. Mounted at /api/club.
 * Auth: unifiedAuth + requireRole("club_admin"). Everything is tenant-scoped by
 * clubId (= the club_admin's own User._id) inside the controllers.
 */
const express = require("express");
const router = express.Router();
const courts = require("../controllers/clubCourtController");
const bookings = require("../controllers/clubBookingController");
const finance = require("../controllers/clubFinanceController");
const members = require("../controllers/clubMemberController");
const coupons = require("../controllers/clubCouponController");
const customers = require("../controllers/clubCustomerController");
const dashboard = require("../controllers/clubDashboardController");
const { unifiedAuth, requireRole } = require("../middleware/rbacMiddleware");

router.use(unifiedAuth, requireRole("club_admin"));

// Dashboard
router.get("/dashboard/summary", dashboard.summary);

// Courts
router.get("/courts", courts.list);
router.post("/courts", courts.create);
router.patch("/courts/:courtId", courts.update);
router.patch("/courts/:courtId/status", courts.updateStatus);
router.delete("/courts/:courtId", courts.remove);

// Bookings (Booking Calendar) — auto-post finance + audit
router.get("/bookings", bookings.list);
router.post("/bookings", bookings.create);
router.patch("/bookings/:bookingId", bookings.update);
router.patch("/bookings/:bookingId/pay", bookings.markPaid);
router.patch("/bookings/:bookingId/cancel", bookings.cancel);
router.patch("/bookings/:bookingId/refund", bookings.refund);
router.delete("/bookings/:bookingId", bookings.remove);

// Finance ledger (foundation for Finance & POS module + dashboard KPIs)
router.get("/finance", finance.list);
router.post("/finance", finance.create);

// Membership packages
router.get("/packages", members.listPackages);
router.post("/packages", members.createPackage);
router.patch("/packages/:packageId", members.updatePackage);
router.delete("/packages/:packageId", members.deletePackage);

// Members — lifecycle auto-posts finance + audit
router.get("/members", members.listMembers);
router.post("/members", members.createMember);
router.patch("/members/:memberId/renew", members.renewMember);
router.patch("/members/:memberId/expire", members.expireMember);
router.patch("/members/:memberId/upgrade", members.upgradeMember);
router.patch("/members/:memberId/refund", members.refundMember);
router.patch("/members/:memberId/toggle-block", members.toggleBlockMember);
router.delete("/members/:memberId", members.removeMember);

// Coupons (marketing promo codes)
router.get("/coupons", coupons.list);
router.post("/coupons", coupons.create);
router.patch("/coupons/:couponId", coupons.update);
router.delete("/coupons/:couponId", coupons.remove);

// CRM — customer profiles + timeline (auto-built from bookings/memberships)
router.get("/customers", customers.list);
router.patch("/customers/:customerId/note", customers.addNote);
router.delete("/customers/:customerId", customers.remove);

module.exports = router;
