const Booking = require("../Modal/BookingModel");
const Payment = require("../Modal/Payments");
const mongoose = require("mongoose");
const User = require("../Modal/User");
const Notification = require("../Modal/Notification");

const bookingController = {

  createBooking: async (req, res) => {
    try {
      const {
        userId,
        userName,
        tournamentId,
        tournamentName,
        team,
        paymentId,
        paymentAmount,
        paymentMethod,
        tournamentType,
        selectedCategories,
      } = req.body;

      // Basic validation
      const missingFields = [];
      if (!userId) missingFields.push("userId");
      if (!userName) missingFields.push("userName");
      if (!tournamentId) missingFields.push("tournamentId");
      if (!tournamentName) missingFields.push("tournamentName");
      if (!tournamentType) missingFields.push("tournamentType");

      if (missingFields.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Missing required fields: ${missingFields.join(", ")}`,
          receivedData: req.body,
        });
      }

      // ✅ Normalize paymentMethod (default = "cash")
      let normalizedPaymentMethod = "cash"; // default
      if (paymentMethod && typeof paymentMethod === "string") {
        const pm = paymentMethod.toLowerCase().trim();
        if (["cash", "online"].includes(pm)) {
          normalizedPaymentMethod = pm;
        }
      }
      // Check for corporate whitelist
      const Tournament = require("../Modal/Tournament");
      const tournament = await Tournament.findById(tournamentId);

      if (tournament && tournament.whitelist && tournament.whitelist.length > 0) {
        // We match by mobile or employeeId
        // Fetch user's mobile if not provided
        let userMobile = req.body.userPhone || req.body.mobile;
        if (!userMobile) {
          const user = await User.findById(userId);
          userMobile = user?.mobile || user?.phone;
        }

        const employeeId = req.body.employeeId;

        const isWhitelisted = tournament.whitelist.some(emp => {
          const mobileMatch = userMobile && emp.mobile && (emp.mobile.toString() === userMobile.toString());
          const idMatch = employeeId && emp.employeeId && (emp.employeeId.toString() === employeeId.toString());
          return mobileMatch || idMatch;
        });

        if (!isWhitelisted) {
          return res.status(403).json({
            success: false,
            message: "This is a restricted corporate tournament. Only authorized employees can register. If you are an employee, please ensure your details match the company list."
          });
        }
      }

      // Check for existing booking
      const existingBooking = await Booking.findOne({ userId, tournamentId });
      if (existingBooking) {
        return res.status(200).json({
          success: false,
          message: "You have already registered for this tournament",
          bookingStatus: existingBooking.status,
          paymentStatus: existingBooking.paymentStatus,
          booking: existingBooking.toObject(),
        });
      }

      let bookingData = {
        userId,
        userName,
        tournamentId,
        tournamentName,
        status: "pending",
        tournamentType,
        paymentMethod: normalizedPaymentMethod, // ✅ always set to cash if not sent
        paymentStatus: "pending",
        selectedCategories: selectedCategories || [],
        employeeId: req.body.employeeId,
      };

      // Handle payment
      let paymentRecord;
      if (paymentAmount === 0 && normalizedPaymentMethod !== "cash") {
        // Free tournament (but not cash)
        paymentRecord = new Payment({
          userId,
          orderId: `FREE_${Date.now()}_${userId}`,
          eventId: tournamentId,
          amount: 0,
          status: "pending",
          paymentMethod: "online", // Use valid enum value for free tournaments
          paymentDate: new Date(),
          currency: "INR",
          transactionDetails: {
            paymentMode: "FREE_TOURNAMENT",
            merchantTransactionId: `FREE_${Date.now()}`,
            gatewayResponse: { status: "success" },
          },
        });

        await paymentRecord.save();
        bookingData.paymentId = paymentRecord._id;
        bookingData.paymentMethod = "online";
        bookingData.paymentStatus = "paid"; // free = auto paid
      } else if (paymentId) {
        // Online payment
        paymentRecord = await Payment.findById(paymentId);
        if (!paymentRecord || paymentRecord.status !== "completed") {
          return res.status(400).json({
            success: false,
            message: "Valid payment confirmation is required",
            paymentStatus: paymentRecord ? paymentRecord.status : "not found",
          });
        }
        bookingData.paymentId = paymentId;
        bookingData.paymentMethod = "online";
        bookingData.paymentStatus = "pending";
        bookingData.status = "pending"
      } else if (normalizedPaymentMethod === "cash") {
        // Offline cash
        bookingData.paymentMethod = "cash";
        bookingData.paymentStatus = "pending";
        bookingData.status = "pending"
      }

      // Team Knockouts flow
      if (tournamentType === "Team Knockouts" || tournamentType === "knockout") {
        if (!team || !team.name || team.name.trim() === "") {
          return res.status(400).json({
            success: false,
            message: "Team name is required and cannot be empty",
          });
        }

        // Format players & substitutes
        const formattedPlayers = (team.players || []).map((player) => ({
          name: player,
          id: new mongoose.Types.ObjectId().toString(),
          profileImage: "",
        }));
        const formattedSubstitutes = (team.substitutes || []).map((sub) => ({
          name: sub,
          id: new mongoose.Types.ObjectId().toString(),
          profileImage: "",
        }));

        const allPlayerNames = [
          team.captain,
          ...formattedPlayers.map((p) => p.name),
          ...formattedSubstitutes.map((s) => s.name),
        ]
          .filter(Boolean)
          .map((n) => n.trim());

        const uniquePlayers = new Set(allPlayerNames);
        if (uniquePlayers.size !== allPlayerNames.length) {
          return res.status(400).json({
            success: false,
            message:
              "Duplicate players found in the team. Each player can only be registered once.",
          });
        }

        // Check if players already exist in other teams
        const existingBookings = await Booking.find({
          tournamentId,
          tournamentType: "Team Knockouts",
        });

        const existingPlayers = new Set();
        existingBookings.forEach((b) => {
          if (b.team) {
            if (b.team.captain) existingPlayers.add(b.team.captain.name.trim());
            b.team.players?.forEach((p) => existingPlayers.add(p.name.trim()));
            b.team.substitutes?.forEach((s) =>
              existingPlayers.add(s.name.trim())
            );
          }
        });

        const alreadyRegisteredPlayers = allPlayerNames.filter((p) =>
          existingPlayers.has(p)
        );
        if (alreadyRegisteredPlayers.length > 0) {
          return res.status(400).json({
            success: false,
            message: `The following players are already registered in other teams: ${alreadyRegisteredPlayers.join(
              ", "
            )}`,
          });
        }

        // Create booking
        const booking = new Booking({
          ...bookingData,
          team: {
            name: team.name,
            positions: {
              A: team.captain,
              B: formattedPlayers[0]?.name || "",
              C: formattedPlayers[1]?.name || "",
            },
            captain: {
              name: team.captain,
              id: new mongoose.Types.ObjectId().toString(),
              profileImage: "",
            },
            players: formattedPlayers,
            substitutes: formattedSubstitutes,
          },
        });

        await booking.save();
        return res.status(201).json({
          success: true,
          message: "Tournament registration confirmed",
          booking: booking.toObject(),
        });
      }
      // Standard booking for other tournament types
      const booking = new Booking(bookingData);
      await booking.save();
      res.status(201).json({
        success: true,
        message: "Tournament registration confirmed",
        booking: booking.toObject(),
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({
        success: false,
        message: "Error processing registration",
        error: error.message,
      });
    }
  },

  checkBooking: async (req, res) => {
    try {
      const { userId, tournamentId } = req.query;
      const booking = await Booking.findOne({
        userId,
        tournamentId,
        status: "confirmed",
      }).populate("tournamentId"); // Populate tournament details if there's a reference

      if (!booking) {
        return res.status(404).json({
          success: false,
          isBooked: false,
          message: "No confirmed booking found",
        });
      }

      res.json({
        success: true,
        isBooked: true,
        booking: {
          _id: booking._id,
          userId: booking.userId,
          tournamentId: booking.tournamentId._id,
          tournamentName: booking.tournamentId.title, // Assuming tournament model has a title field
          tournamentDate: booking.tournamentId.date,
          tournamentTime: booking.tournamentId.time,
          venue: booking.tournamentId.venue,
          team: booking.team,
          status: booking.status,
          createdAt: booking.createdAt,
        },
      });
    } catch (error) {
      console.error("Error checking booking status:", error);
      res.status(500).json({
        success: false,
        message: "Error checking booking status",
        error: error.message,
      });
    }
  },

  getUserBookings: async (req, res) => {
    try {
      const { userId } = req.params;

      // Fetch all bookings for that user (no status filter)
      const bookings = await Booking.find({ userId });

      res.json({
        success: true,
        count: bookings.length,
        data: bookings
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error fetching user bookings",
        error: error.message
      });
    }
  },

  getTournamentBookings: async (req, res) => {
    try {
      const { tournamentId } = req.params;
      const bookings = await Booking.find({
        tournamentId,
      });

      res.json({
        success: true,
        bookings,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error fetching tournament bookings",
      });
    }
  },

  updateBookingStatus: async (req, res) => {
    try {
      const { tournamentId, userId, decision, paymentMethod } = req.body;

      if (!tournamentId || !userId) {
        return res.status(400).json({ success: false, message: "Tournament ID and User ID are required" });
      }

      const booking = await Booking.findOne({ tournamentId, userId });
      if (!booking) {
        return res.status(404).json({ success: false, message: "Booking not found" });
      }

      if (paymentMethod) {
        const allowedPaymentMethods = ["cash", "online"];
        if (allowedPaymentMethods.includes(paymentMethod.toLowerCase())) {
          booking.paymentMethod = paymentMethod.toLowerCase();
        }
      }

      if (decision === "accepted") {
        booking.status = "confirmed";
        booking.paymentStatus = "paid";
      } else if (decision === "rejected") {
        booking.status = "cancelled";
        booking.cancellationReason = "Rejected by manager";
        booking.cancellationDate = new Date();
      } else {
        return res.status(400).json({ success: false, message: "Invalid decision" });
      }

      await booking.save();

      await Notification.findOneAndUpdate(
        { tournamentId, userId },
        { transactionStatus: decision },
        { new: true }
      );

      res.json({
        success: true,
        message: `Booking ${booking.status}`,
        booking,
      });
    } catch (error) {
      console.error("Error updating booking:", error);
      res.status(500).json({ success: false, message: "Failed to update booking", error: error.message });
    }
  },

  bulkUpdateBookingStatus: async (req, res) => {
    try {
      const { items, decision } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, message: "No bookings provided" });
      }

      const bulkOps = items.map(({ userId, tournamentId, paymentMethod }) => {
        let update = {};
        if (decision === "accepted") {
          update = { status: "confirmed", paymentStatus: "paid" };
        } else if (decision === "rejected") {
          update = {
            status: "cancelled",
            cancellationReason: "Rejected by manager",
            cancellationDate: new Date(),
          };
        } else {
          throw new Error("Invalid decision");
        }

        if (paymentMethod) {
          const allowedPaymentMethods = ["cash", "online"];
          if (allowedPaymentMethods.includes(paymentMethod.toLowerCase())) {
            update.paymentMethod = paymentMethod.toLowerCase();
          }
        }

        return {
          updateOne: {
            filter: { userId, tournamentId },
            update: { $set: update },
          },
        };
      });

      await Booking.bulkWrite(bulkOps);

      await Notification.updateMany(
        {
          $or: items.map(({ userId, tournamentId }) => ({ userId, tournamentId })),
        },
        { $set: { transactionStatus: decision } }
      );

      res.json({
        success: true,
        message: `Bulk ${decision} applied to ${items.length} bookings`,
      });
    } catch (err) {
      console.error("Bulk booking update error:", err);
      res.status(500).json({ success: false, message: "Failed to bulk update bookings", error: err.message });
    }
  },
};

module.exports = bookingController;
