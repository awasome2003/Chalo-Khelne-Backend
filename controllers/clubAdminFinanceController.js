const mongoose = require("mongoose");
const Manager = require("../Modal/ClubManager").Manager || require("../Modal/ClubManager");
const Tournament = require("../Modal/Tournament");
const Booking = require("../Modal/BookingModel");
const TurfBooking = require("../Modal/TurfBooking");
const Turf = require("../Modal/Turf");

// Get the Manager model properly
let ManagerModel;
try {
  ManagerModel = mongoose.model("Manager");
} catch {
  ManagerModel = Manager;
}

const clubAdminFinanceController = {
  // =============================
  // GET OVERVIEW — All managers summary
  // =============================
  getOverview: async (req, res) => {
    try {
      const clubAdminId = req.user.id || req.user._id;

      // Get all managers under this club admin
      const managers = await ManagerModel.find({ clubId: clubAdminId })
        .select("name email profileImage isActive createdAt")
        .lean();

      if (managers.length === 0) {
        return res.status(200).json({
          success: true,
          overview: {
            totalManagers: 0,
            totalTournaments: 0,
            totalTournamentRevenue: 0,
            totalBookings: 0,
            totalBookingRevenue: 0,
            grandTotalRevenue: 0,
            managers: [],
          },
        });
      }

      const managerIds = managers.map((m) => m._id);

      // Get tournaments per manager
      const tournamentsByManager = await Tournament.aggregate([
        { $match: { managerId: { $in: managerIds } } },
        { $unwind: "$managerId" },
        { $match: { managerId: { $in: managerIds } } },
        {
          $group: {
            _id: "$managerId",
            totalTournaments: { $sum: 1 },
            tournaments: {
              $push: {
                _id: "$_id",
                tournamentName: "$tournamentName",
                sport: "$sportName",
                type: "$type",
                status: "$status",
                startDate: "$startDate",
                endDate: "$endDate",
                categories: "$category",
              },
            },
          },
        },
      ]);

      // Get tournament bookings (registrations) per manager
      const tournamentIds = [];
      const tournamentManagerMap = {};

      // Fetch all tournaments that belong to managers under this club admin
      const allTournaments = await Tournament.find({ managerId: { $in: managerIds } })
        .select("_id managerId category")
        .lean();

      allTournaments.forEach((t) => {
        tournamentIds.push(t._id);
        // Map tournament to its first manager (primary)
        const mgrId = Array.isArray(t.managerId) ? t.managerId[0]?.toString() : t.managerId?.toString();
        if (mgrId) tournamentManagerMap[t._id.toString()] = mgrId;
      });

      // Get booking revenue per tournament
      const bookingRevenue = await Booking.aggregate([
        {
          $match: {
            tournamentId: { $in: tournamentIds },
            status: { $in: ["confirmed", "pending"] },
          },
        },
        {
          $group: {
            _id: "$tournamentId",
            totalBookings: { $sum: 1 },
            confirmedBookings: {
              $sum: { $cond: [{ $eq: ["$status", "confirmed"] }, 1, 0] },
            },
            totalRevenue: {
              $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, "$paymentAmount", 0] },
            },
          },
        },
      ]);

      // Get turfs owned by each manager
      const turfs = await Turf.find({ owner: { $in: managerIds } }).select("_id owner").lean();
      const turfIds = turfs.map((t) => t._id);
      const turfOwnerMap = {};
      turfs.forEach((t) => {
        turfOwnerMap[t._id.toString()] = t.owner.toString();
      });

      // Get turf booking revenue per turf
      const turfBookingRevenue = await TurfBooking.aggregate([
        {
          $match: {
            turfId: { $in: turfIds },
            status: { $in: ["confirmed", "completed"] },
          },
        },
        {
          $group: {
            _id: "$turfId",
            totalBookings: { $sum: 1 },
            totalRevenue: { $sum: "$amount" },
          },
        },
      ]);

      // Build per-manager summary
      const tournamentMap = {};
      tournamentsByManager.forEach((t) => {
        tournamentMap[t._id.toString()] = t;
      });

      const bookingRevenueMap = {};
      bookingRevenue.forEach((b) => {
        const mgrId = tournamentManagerMap[b._id.toString()];
        if (mgrId) {
          if (!bookingRevenueMap[mgrId]) bookingRevenueMap[mgrId] = { bookings: 0, confirmed: 0, revenue: 0 };
          bookingRevenueMap[mgrId].bookings += b.totalBookings;
          bookingRevenueMap[mgrId].confirmed += b.confirmedBookings;
          bookingRevenueMap[mgrId].revenue += b.totalRevenue;
        }
      });

      const turfBookingMap = {};
      turfBookingRevenue.forEach((tb) => {
        const mgrId = turfOwnerMap[tb._id.toString()];
        if (mgrId) {
          if (!turfBookingMap[mgrId]) turfBookingMap[mgrId] = { bookings: 0, revenue: 0 };
          turfBookingMap[mgrId].bookings += tb.totalBookings;
          turfBookingMap[mgrId].revenue += tb.totalRevenue;
        }
      });

      let totalTournaments = 0;
      let totalTournamentRevenue = 0;
      let totalBookings = 0;
      let totalBookingRevenue = 0;

      const managerSummaries = managers.map((mgr) => {
        const mgrIdStr = mgr._id.toString();
        const tData = tournamentMap[mgrIdStr] || { totalTournaments: 0 };
        const bData = bookingRevenueMap[mgrIdStr] || { bookings: 0, confirmed: 0, revenue: 0 };
        const tbData = turfBookingMap[mgrIdStr] || { bookings: 0, revenue: 0 };

        totalTournaments += tData.totalTournaments;
        totalTournamentRevenue += bData.revenue;
        totalBookings += tbData.bookings;
        totalBookingRevenue += tbData.revenue;

        return {
          _id: mgr._id,
          name: mgr.name,
          email: mgr.email,
          profileImage: mgr.profileImage,
          isActive: mgr.isActive,
          joinedAt: mgr.createdAt,
          tournaments: tData.totalTournaments,
          tournamentRevenue: bData.revenue,
          tournamentBookings: bData.bookings,
          confirmedBookings: bData.confirmed,
          turfBookings: tbData.bookings,
          turfRevenue: tbData.revenue,
          totalRevenue: bData.revenue + tbData.revenue,
        };
      });

      // Sort by total revenue descending
      managerSummaries.sort((a, b) => b.totalRevenue - a.totalRevenue);

      res.status(200).json({
        success: true,
        overview: {
          totalManagers: managers.length,
          totalTournaments,
          totalTournamentRevenue,
          totalBookings,
          totalBookingRevenue,
          grandTotalRevenue: totalTournamentRevenue + totalBookingRevenue,
          managers: managerSummaries,
        },
      });
    } catch (error) {
      console.error("[CLUB_ADMIN_FINANCE] Overview error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch overview", error: error.message });
    }
  },

  // =============================
  // GET MANAGER DETAIL — Tournaments + Revenue
  // =============================
  getManagerDetail: async (req, res) => {
    try {
      const clubAdminId = req.user.id || req.user._id;
      const { managerId } = req.params;

      // Verify manager belongs to this club admin
      const manager = await ManagerModel.findOne({ _id: managerId, clubId: clubAdminId })
        .select("name email profileImage isActive createdAt")
        .lean();

      if (!manager) {
        return res.status(404).json({ success: false, message: "Manager not found or not under your club" });
      }

      // Get all tournaments by this manager
      const tournaments = await Tournament.find({ managerId: managerId })
        .select("tournamentName sportName type status startDate endDate category registeredTeams maxTeams")
        .sort({ createdAt: -1 })
        .lean();

      // Get booking details per tournament
      const tournamentIds = tournaments.map((t) => t._id);
      const bookings = await Booking.find({
        tournamentId: { $in: tournamentIds },
      })
        .select("tournamentId status paymentStatus paymentAmount selectedCategories userName createdAt")
        .sort({ createdAt: -1 })
        .lean();

      // Group bookings by tournament
      const bookingsByTournament = {};
      bookings.forEach((b) => {
        const tId = b.tournamentId.toString();
        if (!bookingsByTournament[tId]) bookingsByTournament[tId] = [];
        bookingsByTournament[tId].push(b);
      });

      // Enrich tournaments with booking data
      const enrichedTournaments = tournaments.map((t) => {
        const tBookings = bookingsByTournament[t._id.toString()] || [];
        const confirmed = tBookings.filter((b) => b.status === "confirmed");
        const paidRevenue = tBookings
          .filter((b) => b.paymentStatus === "paid")
          .reduce((sum, b) => sum + (b.paymentAmount || 0), 0);

        // Category fee breakdown
        const categoryRevenue = {};
        confirmed.forEach((b) => {
          (b.selectedCategories || []).forEach((cat) => {
            const key = cat.name || "General";
            if (!categoryRevenue[key]) categoryRevenue[key] = { count: 0, revenue: 0, fee: cat.price || 0 };
            categoryRevenue[key].count += 1;
            categoryRevenue[key].revenue += cat.price || 0;
          });
        });

        return {
          ...t,
          totalRegistrations: tBookings.length,
          confirmedRegistrations: confirmed.length,
          pendingRegistrations: tBookings.filter((b) => b.status === "pending").length,
          cancelledRegistrations: tBookings.filter((b) => b.status === "cancelled").length,
          paidRevenue,
          categoryRevenue,
        };
      });

      // Get turf booking summary
      const turfs = await Turf.find({ owner: managerId }).select("_id name").lean();
      const turfIds = turfs.map((t) => t._id);

      const turfBookings = await TurfBooking.aggregate([
        { $match: { turfId: { $in: turfIds } } },
        {
          $group: {
            _id: "$turfId",
            totalBookings: { $sum: 1 },
            confirmedBookings: {
              $sum: { $cond: [{ $in: ["$status", ["confirmed", "completed"]] }, 1, 0] },
            },
            cancelledBookings: {
              $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
            },
            totalRevenue: {
              $sum: {
                $cond: [{ $in: ["$status", ["confirmed", "completed"]] }, "$amount", 0],
              },
            },
          },
        },
      ]);

      // Map turf names
      const turfNameMap = {};
      turfs.forEach((t) => {
        turfNameMap[t._id.toString()] = t.name;
      });

      const turfSummary = turfBookings.map((tb) => ({
        turfId: tb._id,
        turfName: turfNameMap[tb._id.toString()] || "Unknown Turf",
        totalBookings: tb.totalBookings,
        confirmedBookings: tb.confirmedBookings,
        cancelledBookings: tb.cancelledBookings,
        revenue: tb.totalRevenue,
      }));

      // Totals
      const totalTournamentRevenue = enrichedTournaments.reduce((sum, t) => sum + t.paidRevenue, 0);
      const totalTurfRevenue = turfSummary.reduce((sum, t) => sum + t.revenue, 0);

      res.status(200).json({
        success: true,
        manager,
        tournaments: enrichedTournaments,
        turfSummary,
        totals: {
          totalTournaments: tournaments.length,
          totalTournamentRevenue,
          totalTurfBookings: turfSummary.reduce((sum, t) => sum + t.totalBookings, 0),
          totalTurfRevenue,
          grandTotal: totalTournamentRevenue + totalTurfRevenue,
        },
      });
    } catch (error) {
      console.error("[CLUB_ADMIN_FINANCE] Manager detail error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch manager details", error: error.message });
    }
  },

  // =============================
  // GET TOURNAMENT DETAIL — Full breakdown
  // =============================
  getTournamentDetail: async (req, res) => {
    try {
      const clubAdminId = req.user.id || req.user._id;
      const { tournamentId } = req.params;

      const tournament = await Tournament.findById(tournamentId)
        .select("tournamentName sportName type status startDate endDate category registeredTeams maxTeams managerId")
        .lean();

      if (!tournament) {
        return res.status(404).json({ success: false, message: "Tournament not found" });
      }

      // Verify this tournament belongs to a manager under this club admin
      const managerIds = Array.isArray(tournament.managerId) ? tournament.managerId : [tournament.managerId];
      const validManager = await ManagerModel.findOne({
        _id: { $in: managerIds },
        clubId: clubAdminId,
      });

      if (!validManager) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }

      // Get all bookings for this tournament
      const bookings = await Booking.find({ tournamentId })
        .select("userName userEmail userPhone status paymentStatus paymentAmount paymentMethod selectedCategories team createdAt")
        .sort({ createdAt: -1 })
        .lean();

      // Revenue breakdown
      const totalRegistrations = bookings.length;
      const confirmed = bookings.filter((b) => b.status === "confirmed");
      const paid = bookings.filter((b) => b.paymentStatus === "paid");
      const totalRevenue = paid.reduce((sum, b) => sum + (b.paymentAmount || 0), 0);

      // Category breakdown
      const categoryBreakdown = {};
      bookings.forEach((b) => {
        (b.selectedCategories || []).forEach((cat) => {
          const key = cat.name || "General";
          if (!categoryBreakdown[key]) {
            categoryBreakdown[key] = { name: key, fee: cat.price || 0, total: 0, confirmed: 0, paid: 0, revenue: 0 };
          }
          categoryBreakdown[key].total += 1;
          if (b.status === "confirmed") categoryBreakdown[key].confirmed += 1;
          if (b.paymentStatus === "paid") {
            categoryBreakdown[key].paid += 1;
            categoryBreakdown[key].revenue += cat.price || 0;
          }
        });
      });

      res.status(200).json({
        success: true,
        tournament,
        registrations: bookings,
        summary: {
          totalRegistrations,
          confirmedRegistrations: confirmed.length,
          pendingRegistrations: bookings.filter((b) => b.status === "pending").length,
          cancelledRegistrations: bookings.filter((b) => b.status === "cancelled").length,
          paidCount: paid.length,
          totalRevenue,
          categoryBreakdown: Object.values(categoryBreakdown),
        },
      });
    } catch (error) {
      console.error("[CLUB_ADMIN_FINANCE] Tournament detail error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch tournament details", error: error.message });
    }
  },
};

module.exports = clubAdminFinanceController;
