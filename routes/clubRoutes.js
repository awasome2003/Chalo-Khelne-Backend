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
const coaches = require("../controllers/clubCoachController");
const staff = require("../controllers/clubStaffController");
const inventory = require("../controllers/clubInventoryController");
const reports = require("../controllers/clubReportController");
const broadcasts = require("../controllers/clubBroadcastController");
const reviews = require("../controllers/clubReviewController");
const settings = require("../controllers/clubSettingController");
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

// Coaches — attendance + session→payroll auto-expense
router.get("/coaches", coaches.list);
router.post("/coaches", coaches.create);
router.patch("/coaches/:coachId", coaches.update);
router.patch("/coaches/:coachId/attendance", coaches.updateAttendance);
router.patch("/coaches/:coachId/assign-session", coaches.assignSession);
router.delete("/coaches/:coachId", coaches.remove);

// Staff & Roles — role-based permissions + attendance
router.get("/staff", staff.list);
router.post("/staff", staff.create);
router.patch("/staff/:staffId", staff.update);
router.patch("/staff/:staffId/attendance", staff.updateAttendance);
router.patch("/staff/:staffId/permissions", staff.updatePermissions);
router.delete("/staff/:staffId", staff.remove);

// Inventory — stock / restock / rent→income
router.get("/inventory", inventory.list);
router.post("/inventory", inventory.create);
router.patch("/inventory/:itemId", inventory.update);
router.patch("/inventory/:itemId/restock", inventory.restock);
router.patch("/inventory/:itemId/rent", inventory.rent);
router.delete("/inventory/:itemId", inventory.remove);

// Reports & Analytics — real aggregation + CSV/PDF exports
router.get("/reports/summary", reports.summary);
router.get("/reports/finance.csv", reports.financeCsv);
router.get("/reports/report.pdf", reports.reportPdf);

// Communication — broadcast announcements + dispatch history
router.get("/broadcasts", broadcasts.list);
router.post("/broadcasts", broadcasts.create);
router.delete("/broadcasts/:broadcastId", broadcasts.remove);

// Reviews — Club/Coach/Court testimonials + admin replies
router.get("/reviews", reviews.list);
router.post("/reviews", reviews.create);
router.patch("/reviews/:reviewId/reply", reviews.reply);
router.delete("/reviews/:reviewId", reviews.remove);

// Settings — one config doc per club
router.get("/settings", settings.get);
router.put("/settings", settings.update);

module.exports = router;
