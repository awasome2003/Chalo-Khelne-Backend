const express = require("express");
const router = express.Router();
const clubAdminFinanceController = require("../controllers/clubAdminFinanceController");
const { authenticate, requireRole } = require("../middleware/authMiddleware");

// All routes require authentication AND a finance-owning role.
// authenticate proves who the caller is; requireRole restricts to club/corporate
// admins (superadmin is always allowed by requireRole). Previously this route had
// only authenticate — any logged-in user could hit the finance endpoints.
router.use(authenticate);
router.use(requireRole("ClubAdmin", "corporate_admin"));

// Overview — all managers summary with revenue
router.get("/overview", clubAdminFinanceController.getOverview);

// Single manager detail — tournaments + turf bookings + revenue
router.get("/manager/:managerId", clubAdminFinanceController.getManagerDetail);

// Tournament detail — registrations + category breakdown
router.get("/tournament/:tournamentId", clubAdminFinanceController.getTournamentDetail);

// All payments — combined tournament + turf bookings (paginated + filtered)
router.get("/payments", clubAdminFinanceController.getAllPayments);

module.exports = router;
