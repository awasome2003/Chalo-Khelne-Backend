const express = require("express");
const router = express.Router();
const clubAdminFinanceController = require("../controllers/clubAdminFinanceController");
const { authenticate } = require("../middleware/authMiddleware");

// All routes require authentication (Club Admin is a User with role ClubAdmin)
router.use(authenticate);

// Overview — all managers summary with revenue
router.get("/overview", clubAdminFinanceController.getOverview);

// Single manager detail — tournaments + turf bookings + revenue
router.get("/manager/:managerId", clubAdminFinanceController.getManagerDetail);

// Tournament detail — registrations + category breakdown
router.get("/tournament/:tournamentId", clubAdminFinanceController.getTournamentDetail);

module.exports = router;
