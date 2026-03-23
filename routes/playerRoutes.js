// routes/merged-routes.js
const express = require("express");
const router = express.Router();
const Razorpay = require("razorpay");
const crypto = require("crypto");
const Payment = require("../Modal/Payments");
const Booking = require("../Modal/BookingModel");
const TurfBooking = require("../Modal/TurfBooking");
const Tournament = require("../Modal/Tournament");
const Turf = require("../Modal/Turf");
const User = require("../Modal/User");
const { Manager } = require("../Modal/ClubManager");
const mongoose = require("mongoose");

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ===== TOURNAMENT BOOKING ROUTES =====

// Route to fetch tournament teams
router.get("/bookings/tournament-teams/:tournamentId", async (req, res) => {
  try {
    const { tournamentId } = req.params;

    // Validate tournamentId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(tournamentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tournament ID format",
      });
    }

    // Find all bookings for this tournament that have team data
    const bookings = await Booking.find({
      tournamentId: tournamentId,
      "team.name": { $exists: true }, // Only get bookings with team data
    }).sort({ createdAt: -1 });

    // Transform the data to match the expected format
    const transformedBookings = bookings.map((booking) => ({
      _id: booking._id,
      team: {
        name: booking.team.name,
        captain: booking.team.captain.name,
        players: booking.team.players || [],
        substitutes: booking.team.substitutes || [],
      },
      createdAt: booking.createdAt,
    }));

    // Send the response
    res.json({
      success: true,
      bookings: transformedBookings,
    });
  } catch (error) {
    console.error("Error fetching tournament teams:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching tournament teams",
      error: error.message,
    });
  }
});

// Fetch specific team details
router.get("/team-details/:bookingId", async (req, res) => {
  try {
    const { bookingId } = req.params;

    const booking = await Booking.findById(bookingId);
    if (!booking || !booking.team) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    const teamDetails = {
      _id: booking._id,
      team: {
        name: booking.team.name,
        captain: booking.team.captain,
        players: booking.team.players,
        substitutes: booking.team.substitutes || [],
      },
      tournamentId: booking.tournamentId,
      createdAt: booking.createdAt,
      tournamentName: booking.tournamentName,
    };

    return res.json({
      success: true,
      teamDetails,
    });
  } catch (error) {
    console.error("Error fetching team details:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch team details",
      error: error.message,
    });
  }
});

// Check booking status
router.get("/bookings/status", async (req, res) => {
  try {
    const { userId, tournamentId } = req.query;

    if (!userId || !tournamentId) {
      return res.status(400).json({
        success: false,
        message: "User ID and Tournament ID are required",
      });
    }

    // Find existing booking
    const booking = await Booking.findOne({
      userId,
      tournamentId,
      status: "confirmed",
    });

    return res.json({
      success: true,
      isBooked: !!booking,
      booking: booking || null,
    });
  } catch (error) {
    console.error("Error checking booking status:", error);
    return res.status(500).json({
      success: false,
      message: "Error checking booking status",
      error: error.message,
    });
  }
});

// Get user's bookings
router.get("/bookings/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    const bookings = await Booking.find({ userId }).sort({ createdAt: -1 });

    return res.json({
      success: true,
      bookings,
    });
  } catch (error) {
    console.error("Error fetching user bookings:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user bookings",
      error: error.message,
    });
  }
});

// Get booking by ID
router.get("/booking/:bookingId", async (req, res) => {
  try {
    const { bookingId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID format",
      });
    }

    const booking = await Booking.findById(bookingId);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    return res.json({
      success: true,
      booking,
    });
  } catch (error) {
    console.error("Error fetching booking:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch booking",
      error: error.message,
    });
  }
});

// ===== PLAYER/USER ROUTES =====

// Validate players
router.post("/users/validate-players", async (req, res) => {
  try {
    const { players } = req.body;
    console.log("Received players for validation:", players);

    if (!players || !Array.isArray(players)) {
      return res.status(400).json({
        success: false,
        message: "Invalid players data",
      });
    }

    // Clean player names - trim whitespace
    const cleanedPlayers = players.map((name) => name.trim());
    console.log("Cleaned player names:", cleanedPlayers);

    // Find all users first to debug
    const allUsers = await User.find({
      isApproved: true,
      role: { $regex: new RegExp("^player$", "i") },
    }).select("name");

    console.log(
      "All approved players in database:",
      allUsers.map((user) => ({
        name: user.name,
        nameLength: user.name.length,
        hasTrailingSpace: user.name.endsWith(" "),
        trimmedName: user.name.trim(),
      }))
    );

    // Find valid users with exact matching after trimming
    const validUsers = await User.find({
      name: {
        $in: cleanedPlayers.map(
          (name) => new RegExp(`^${name.trim()}\\s*$`, "i")
        ),
      },
      isApproved: true,
      role: { $regex: new RegExp("^player$", "i") },
    }).select("name");

    console.log("Found valid users:", validUsers);

    // Map valid players with trimmed names
    const validPlayers = validUsers.map((user) => user.name.trim());

    // Find invalid players using trimmed comparison
    const invalidPlayers = cleanedPlayers.filter(
      (player) =>
        !validPlayers.some(
          (valid) => valid.toLowerCase().trim() === player.toLowerCase().trim()
        )
    );

    console.log("Detailed validation results:");
    cleanedPlayers.forEach((player) => {
      console.log(`Checking player: "${player}"`);
      console.log(`- Trimmed version: "${player.trim()}"`);
      console.log(`- Length: ${player.length}`);
      console.log(
        `- Found in valid players: ${validPlayers.includes(player.trim())}`
      );
    });

    console.log("Valid players:", validPlayers);
    console.log("Invalid players:", invalidPlayers);

    return res.status(200).json({
      success: true,
      validPlayers,
      invalidPlayers,
      message: "Players validation completed",
    });
  } catch (error) {
    console.error("Error validating players:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get player by ID
router.get("/player/:playerId", async (req, res) => {
  try {
    console.log("Searching for player with ID:", req.params.playerId);

    // Validate if the ID is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(req.params.playerId)) {
      console.log("Invalid ObjectId format:", req.params.playerId);
      return res.status(400).json({ message: "Invalid player ID format" });
    }

    const player = await User.findById(req.params.playerId);

    if (!player) {
      console.log("Player not found with ID:", req.params.playerId);
      return res.status(404).json({ message: "Player not found" });
    }

    console.log("Player found:", player);

    const playerData = {
      _id: player._id,
      name: player.name,
      email: player.email,
      mobile: player.mobile,
      sports: player.sports,
      rank: player.rank,
      profileImage: player.profileImage,
      matchesPlayed: player.matchesPlayed || 0,
      wins: player.wins || 0,
      losses: player.losses || 0,
    };

    res.json(playerData);
  } catch (err) {
    console.error("Error fetching player data:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Get user profile
router.get("/user/profile/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // Find user by ID and exclude sensitive information
    const user = await User.findById(userId)
      .select("-password -resetPasswordToken -resetPasswordExpires")
      .populate("sports"); // If you have a sports reference

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Construct the profile response
    const profileData = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phoneNumber: user.phoneNumber,
      profileImage: user.profileImage,
      sports: user.sports,
      rank: user.rank,
      // Add any other fields you want to include
      stats: {
        wins: user.wins || 0,
        losses: user.losses || 0,
        totalMatches: (user.wins || 0) + (user.losses || 0),
      },
    };

    res.status(200).json({
      success: true,
      data: profileData,
    });
  } catch (error) {
    console.error("Error fetching user profile:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching user profile",
      error: error.message,
    });
  }
});

// Search players
router.get("/search-players", async (req, res) => {
  try {
    const searchQuery = req.query.query || "";

    if (!searchQuery.trim()) {
      return res.json([]);
    }

    // Escape special regex characters in searchQuery
    const escapedQuery = searchQuery.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");

    const players = await User.aggregate([
      // Initial match to filter Players
      {
        $match: {
          role: "Player",
          // Match name starting with the exact letters typed
          name: {
            $regex: `^${escapedQuery}`,
            $options: "i",
          },
        },
      },
      // Sort alphabetically
      { $sort: { name: 1 } },
      // Project only needed fields
      {
        $project: {
          _id: 1,
          name: 1,
          profileImage: 1,
          sports: 1,
          rank: 1,
        },
      },
      // Limit results
      { $limit: 10 },
    ]);

    // If we don't have enough exact prefix matches, add contains matches
    if (players.length < 10) {
      const remainingSlots = 10 - players.length;
      const containsMatches = await User.aggregate([
        {
          $match: {
            role: "Player",
            name: {
              $regex: escapedQuery,
              $options: "i",
            },
            // Exclude names that start with the query (already included above)
            name: {
              $not: {
                $regex: `^${escapedQuery}`,
                $options: "i",
              },
            },
          },
        },
        { $sort: { name: 1 } },
        {
          $project: {
            _id: 1,
            name: 1,
            profileImage: 1,
            sports: 1,
            rank: 1,
          },
        },
        { $limit: remainingSlots },
      ]);

      players.push(...containsMatches);
    }

    res.json(players);
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({ message: "Error searching players" });
  }
});

// ===== TURF BOOKING ROUTES =====

// Get available time slots for a turf
router.get("/turf-availability/:turfId", async (req, res) => {
  try {
    const { turfId } = req.params;
    const { date, sportName } = req.query;

    if (!mongoose.Types.ObjectId.isValid(turfId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid turf ID format",
      });
    }

    if (!date) {
      return res.status(400).json({
        success: false,
        message: "Date is required",
      });
    }

    // Find the turf to get operating hours
    const turf = await Turf.findById(turfId);

    if (!turf) {
      return res.status(404).json({
        success: false,
        message: "Turf not found",
      });
    }

    // Determine which day of the week this date is
    const queryDate = new Date(date);
    const daysOfWeek = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];
    const dayName = daysOfWeek[queryDate.getDay()];

    // Get the available time slots for this day from the turf model
    const turfAvailability = turf.availableTimeSlots.filter(
      (slot) => slot.day === dayName
    );

    if (turfAvailability.length === 0) {
      return res.json({
        success: true,
        date: date,
        message: "No time slots available for this day",
        timeSlots: [],
        sports: turf.sports || [],
      });
    }

    // Get all bookings for this turf on the specified date
    const bookings = await TurfBooking.find({
      turfId,
      date: {
        $gte: new Date(queryDate.setHours(0, 0, 0)),
        $lt: new Date(queryDate.setHours(23, 59, 59)),
      },
      status: { $in: ["pending", "confirmed"] },
    }).select("timeSlot");

    // Create a list of booked time slots
    const bookedTimeSlots = bookings.map((booking) => booking.timeSlot);

    // Generate all available time slots for this day
    const allTimeSlots = [];

    turfAvailability.forEach((availability) => {
      // Parse start and end times to generate hourly slots
      let start = parseInt(availability.startTime.split(":")[0]);
      const end = parseInt(availability.endTime.split(":")[0]);

      for (let hour = start; hour < end; hour++) {
        const startTime = `${hour}:00`;
        const endTime = `${hour + 1}:00`;
        const timeSlot = `${startTime} - ${endTime}`;
        const isBooked = bookedTimeSlots.includes(timeSlot);

        // Get the price for the selected sport
        let price = 0;
        if (sportName) {
          const sport = turf.sports.find((s) => s.name === sportName);
          if (sport) {
            price = sport.pricePerHour;
          }
        } else if (turf.sports.length > 0) {
          // Default to first sport if none specified
          price = turf.sports[0].pricePerHour;
        }

        allTimeSlots.push({
          id: `slot-${hour}`,
          startTime,
          endTime,
          timeSlot,
          available: !isBooked,
          price: price,
        });
      }
    });

    return res.json({
      success: true,
      date: date,
      dayOfWeek: dayName,
      sports: turf.sports || [],
      timeSlots: allTimeSlots,
    });
  } catch (error) {
    console.error("Error fetching availability:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch availability",
      error: error.message,
    });
  }
});

// Get user's turf bookings
router.get("/turf-bookings/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.query;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    // Build query
    const query = { userId };

    // Add status filter if provided
    if (status) {
      query.status = status;
    }

    const bookings = await TurfBooking.find(query)
      .sort({ date: -1, createdAt: -1 })
      .populate("turfId", "name address images"); // Populate turf details

    return res.json({
      success: true,
      bookings,
    });
  } catch (error) {
    console.error("Error fetching user turf bookings:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user bookings",
      error: error.message,
    });
  }
});

// Get turf bookings by turf ID
router.get("/turf-bookings/turf/:turfId", async (req, res) => {
  try {
    const { turfId } = req.params;
    const { date, status } = req.query;

    if (!mongoose.Types.ObjectId.isValid(turfId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid turf ID format",
      });
    }

    // Build query
    const query = { turfId };

    // Add date filter if provided
    if (date) {
      const queryDate = new Date(date);
      query.date = {
        $gte: new Date(queryDate.setHours(0, 0, 0)),
        $lt: new Date(queryDate.setHours(23, 59, 59)),
      };
    }

    // Add status filter if provided
    if (status) {
      query.status = status;
    }

    const bookings = await TurfBooking.find(query)
      .sort({ date: 1, timeSlot: 1 })
      .populate("userId", "name email phone"); // Populate user details

    return res.json({
      success: true,
      bookings,
    });
  } catch (error) {
    console.error("Error fetching turf bookings:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch turf bookings",
      error: error.message,
    });
  }
});

// Get turf booking by ID
router.get("/turf-booking/:bookingId", async (req, res) => {
  try {
    const { bookingId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID format",
      });
    }

    const booking = await TurfBooking.findById(bookingId)
      .populate("userId", "name email phone")
      .populate("turfId", "name address images sports");

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    return res.json({
      success: true,
      booking,
    });
  } catch (error) {
    console.error("Error fetching turf booking:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch booking",
      error: error.message,
    });
  }
});

// ===== PAYMENT ROUTES =====

// Check payment status
router.get("/payments/check", async (req, res) => {
  try {
    const { userId, tournamentId } = req.query;

    if (!userId || !tournamentId) {
      return res.status(400).json({
        success: false,
        message: "User ID and Tournament ID are required",
      });
    }

    // Find the most recent payment for this tournament by this user
    const payment = await Payment.findOne({
      eventId: tournamentId,
      "transactionDetails.userId": userId,
    }).sort({ createdAt: -1 });

    if (!payment) {
      return res.json({
        success: true,
        hasPaid: false,
        status: null,
        payment: null,
      });
    }

    // Check payment status
    const paymentStatus = {
      hasPaid: payment.status === "completed",
      status: payment.status,
      payment: {
        orderId: payment.orderId,
        amount: payment.amount,
        status: payment.status,
        createdAt: payment.createdAt,
        paymentMethod: payment.paymentMethod,
        transactionDetails: payment.transactionDetails,
      },
    };

    return res.json({
      success: true,
      ...paymentStatus,
    });
  } catch (error) {
    console.error("Error checking payment status:", error);
    return res.status(500).json({
      success: false,
      message: "Error checking payment status",
      error: error.message,
    });
  }
});

// Get Payment History
router.get("/payment-history", async (req, res) => {
  try {
    const payments = await Payment.find()
      .sort({ createdAt: -1 }) // Most recent first
      .select({
        _id: 1,
        orderId: 1,
        amount: 1,
        currency: 1,
        status: 1,
        paymentMethod: 1,
        receipt: 1,
        createdAt: 1,
        paymentId: 1,
        transactionDetails: 1,
      });

    res.json({
      success: true,
      payments,
    });
  } catch (error) {
    console.error("Failed to fetch payment history:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get Payment History by User
router.get("/payment-history/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // Validate userId
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "User ID is required",
      });
    }

    const payments = await Payment.find({ userId }) // Add userId filter
      .sort({ createdAt: -1 }) // Most recent first
      .select({
        _id: 1,
        orderId: 1,
        amount: 1,
        currency: 1,
        status: 1,
        paymentMethod: 1,
        receipt: 1,
        createdAt: 1,
        paymentId: 1,
        transactionDetails: 1,
        userId: 1,
      });

    res.json({
      success: true,
      payments,
    });
  } catch (error) {
    console.error("Failed to fetch payment history:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Payment verification helper function
const verifyRazorpaySignature = (orderId, paymentId, signature) => {
  const text = orderId + "|" + paymentId;
  const generated_signature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(text)
    .digest("hex");
  return generated_signature === signature;
};

// Enhanced Payment Verification Handler
const verifyPaymentStatus = async (orderId) => {
  try {
    const payment = await Payment.findOne({ orderId });
    if (!payment) return null;

    // Check if payment is too old (expired)
    const expirationTime = 30 * 60 * 1000; // 30 minutes
    if (Date.now() - payment.createdAt > expirationTime) {
      payment.status = "timeout";
      await payment.save();
      return payment;
    }

    // For UPI payments, check transaction status
    if (payment.paymentMethod === "upi" && payment.status === "pending") {
      const upiStatus = await razorpay.payments.fetch(payment.paymentId);

      switch (upiStatus.status) {
        case "authorized":
        case "captured":
          payment.status = "completed";
          payment.transactionDetails = {
            upiTransactionId: upiStatus.acquirer_data?.upi_transaction_id,
            paymentMode: "UPI",
            gatewayResponse: upiStatus,
          };
          break;
        case "failed":
          payment.status = "failed";
          payment.error = {
            description: "UPI transaction failed",
            code: upiStatus.error_code,
            timestamp: new Date(),
          };
          break;
        case "pending":
          // Keep as pending but update verification attempts
          payment.verificationAttempts += 1;
          payment.lastVerificationTime = new Date();
          break;
      }
    }

    // For netbanking, check bank status
    if (
      payment.paymentMethod === "netbanking" &&
      payment.status === "pending"
    ) {
      const bankStatus = await razorpay.payments.fetch(payment.paymentId);

      if (bankStatus.status === "captured") {
        payment.status = "completed";
        payment.transactionDetails = {
          bankTransactionId: bankStatus.acquirer_data?.bank_transaction_id,
          bankReference: bankStatus.acquirer_data?.bank_reference,
          paymentMode: "NetBanking",
          gatewayResponse: bankStatus,
        };
      }
    }

    await payment.save();
    return payment;
  } catch (error) {
    console.error("Payment verification error:", error);
    return null;
  }
};

// Create Order - Enhanced with detailed logging
router.post("/create-order", async (req, res) => {
  try {
    const { amount, eventId, paymentMethod = "any", userId } = req.body;
    console.log("Creating order:", { amount, eventId, paymentMethod, userId });

    // Input validation
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid amount",
        details: "Amount must be greater than 0",
      });
    }

    if (!eventId || !mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid eventId",
        details: "eventId must be a valid MongoDB ObjectId",
      });
    }

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid userId",
        details: "userId must be a valid MongoDB ObjectId",
      });
    }

    // Check if Razorpay is properly initialized
    if (!razorpay) {
      console.error("Razorpay not initialized");
      return res.status(500).json({
        success: false,
        error: "Payment gateway not configured",
        details: "Contact the administrator",
      });
    }

    // Validate event exists
    try {
      const tournament = await Tournament.findById(eventId);
      if (!tournament) {
        console.log("Tournament not found:", eventId);
        return res.status(404).json({
          success: false,
          error: "Tournament not found",
        });
      }
    } catch (tournamentError) {
      console.error("Error finding tournament:", tournamentError);
      return res.status(500).json({
        success: false,
        error: "Database error",
        details: "Error finding tournament",
      });
    }

    const receipt = "receipt_" + Math.random().toString(36).substring(7);
    console.log("Generated receipt:", receipt);

    // Ensure amount is an integer (Razorpay requirement)
    const amountInPaise = Math.round(Number(amount));

    const options = {
      amount: amountInPaise,
      currency: "INR",
      receipt: receipt,
    };

    console.log("Razorpay order options:", options);

    // Create Razorpay order with detailed error handling
    let razorpayOrder;
    try {
      razorpayOrder = await razorpay.orders.create(options);
      console.log("Razorpay order created:", razorpayOrder);
    } catch (razorpayError) {
      console.error("Razorpay API Error:", {
        message: razorpayError.message,
        stack: razorpayError.stack,
        code: razorpayError.code,
        statusCode: razorpayError.statusCode,
        description: razorpayError.description,
      });

      return res.status(500).json({
        success: false,
        error: "Payment gateway error",
        message: razorpayError.message,
        code: razorpayError.code || "UNKNOWN",
      });
    }

    // Create payment record in database
    try {
      const payment = new Payment({
        orderId: razorpayOrder.id,
        userId: userId,
        eventId: eventId,
        amount: amountInPaise / 100, // Convert back to regular currency
        currency: "INR",
        receipt: receipt,
        status: "created",
        paymentMethod: paymentMethod || "any",
        attempts: 0,
        createTime: Date.now(),
      });

      await payment.save();
      console.log("Payment record created:", payment);
    } catch (dbError) {
      console.error("Database error creating payment record:", dbError);
      // Still return the order to client since Razorpay order was created
      // Just log the database error
    }

    return res.status(200).json({
      success: true,
      ...razorpayOrder,
    });
  } catch (error) {
    console.error("Order creation failed:", {
      message: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      success: false,
      error: "Server error",
      message: error.message,
    });
  }
});

// Enhanced verify-payment route with real-time handling
router.post("/verify-payment", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      status,
      paymentMethod,
      userId,
      eventId,
      userName,
      tournamentName,
      tournamentType,
      team,
    } = req.body;

    // Log the tournamentType to debug
    console.log("Tournament Type received:", tournamentType);

    let payment = await Payment.findOne({ orderId: razorpay_order_id });
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment record not found",
      });
    }

    // Update payment with additional information
    payment.userId = userId || payment.userId;
    payment.eventId = eventId || payment.eventId;

    // Handle network timeouts and pending states
    if (status === "pending") {
      payment.status = "pending";
      payment.pendingReason =
        req.body.pendingReason || "Awaiting bank confirmation";
      payment.processingTimeout = new Date(Date.now() + 10 * 60 * 1000);
      await payment.save();

      return res.json({
        success: true,
        status: "pending",
        message: "Payment is being processed",
        payment: payment,
      });
    }

    // Verify signature
    const isValid = verifyRazorpaySignature(
      payment.orderId,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!isValid) {
      payment.status = "failed";
      payment.error = {
        description: "Invalid signature",
        code: "SIGNATURE_VERIFICATION_FAILED",
        timestamp: new Date(),
      };
      await payment.save();
      return res.status(400).json({
        success: false,
        message: "Invalid payment signature",
      });
    }

    try {
      // Fetch payment status from Razorpay
      const paymentStatus = await razorpay.payments.fetch(razorpay_payment_id);
      console.log("Razorpay payment status:", paymentStatus.status);

      if (paymentStatus.status === "captured") {
        // Update payment record
        payment.status = "completed";
        payment.paymentId = razorpay_payment_id;
        payment.transactionDetails = {
          paymentMode: paymentStatus.method || paymentMethod || "online",
          gatewayResponse: paymentStatus,
          verifiedAt: new Date(),
        };
        await payment.save();

        // Create booking record
        try {
          // Get tournament details to get the tournament type if not provided
          let resolvedTournamentType = tournamentType;

          if (!resolvedTournamentType) {
            try {
              const tournament = await Tournament.findById(payment.eventId);
              if (tournament && tournament.type) {
                resolvedTournamentType = tournament.type;
                console.log(
                  `Retrieved tournament type from database: ${resolvedTournamentType}`
                );
              }
            } catch (err) {
              console.error("Error fetching tournament type:", err);
            }
          }

          // Validate tournament type against schema enum
          const validTournamentTypes = [
            "Team Knockouts",
            "Group Stage",
            "Single Elimination",
            "Double Elimination",
            "Round Robin",
          ];

          if (!validTournamentTypes.includes(resolvedTournamentType)) {
            console.log(
              `Invalid tournament type: ${resolvedTournamentType}. Attempting to find valid type.`
            );

            // If notes contains a valid type, use that
            const notesType =
              payment.transactionDetails?.gatewayResponse?.notes
                ?.tournamentType;
            if (notesType && validTournamentTypes.includes(notesType)) {
              resolvedTournamentType = notesType;
            } else {
              // Log error but continue with a valid value
              console.error(
                `No valid tournament type found. Using "Group Stage" as fallback.`
              );
              resolvedTournamentType = "Group Stage";
            }
          }

          // Prepare booking data
          const bookingData = {
            userId: payment.userId,
            userName: userName || "User", // Request parameter first
            tournamentId: payment.eventId,
            tournamentName: tournamentName || "Tournament Name", // Request parameter first
            status: "confirmed",
            tournamentType: resolvedTournamentType,
            paymentId: payment._id,
          };

          // Log the exact data
          console.log(
            "Final booking data:",
            JSON.stringify({
              userId: bookingData.userId,
              userName: bookingData.userName,
              tournamentName: bookingData.tournamentName,
              tournamentType: bookingData.tournamentType,
            })
          );

          // If there's team data, add it
          if (team) {
            // Format players according to schema
            if (team.players && Array.isArray(team.players)) {
              const formattedPlayers = team.players.map((player) => ({
                name: player,
                id: new mongoose.Types.ObjectId().toString(),
                profileImage: "", // Default empty string for profile image
              }));

              const formattedSubstitutes = (team.substitutes || []).map(
                (sub) => ({
                  name: sub,
                  id: new mongoose.Types.ObjectId().toString(),
                  profileImage: "", // Default empty string for profile image
                })
              );

              // Create team object with proper schema format
              bookingData.team = {
                name: team.name,
                positions: {
                  A: team.captain, // Captain
                  B: formattedPlayers[0]?.name || "", // First player
                  C: formattedPlayers[1]?.name || "", // Second player
                },
                captain: {
                  name: team.captain,
                  id: new mongoose.Types.ObjectId().toString(),
                  profileImage: "", // Default empty string for profile image
                },
                players: formattedPlayers,
                substitutes: formattedSubstitutes,
              };
            } else {
              // If team is in a different format, use it directly
              bookingData.team = team;
            }
          }

          console.log("Creating booking with data:", bookingData);

          // Create and save booking
          const booking = new Booking(bookingData);
          await booking.save();

          console.log("Booking created successfully:", booking._id);

          // Include booking in response
          return res.json({
            success: true,
            message: "Payment successful and booking created",
            payment,
            booking: booking.toObject(),
          });
        } catch (bookingError) {
          console.error("Booking creation error:", bookingError);
          // Still return payment success even if booking creation fails
          return res.json({
            success: true,
            message: "Payment successful but booking creation failed",
            payment,
            error: bookingError.message,
          });
        }
      } else {
        // Payment was not captured
        payment.status = "failed";
        payment.error = {
          description: "Payment not captured",
          code: "PAYMENT_NOT_CAPTURED",
          timestamp: new Date(),
        };
        await payment.save();

        return res.status(400).json({
          success: false,
          message: "Payment not captured",
          paymentStatus: paymentStatus.status,
        });
      }
    } catch (error) {
      console.error("Payment verification API error:", error);
      payment.status = "failed";
      payment.error = {
        description: error.message,
        code: "PAYMENT_VERIFICATION_ERROR",
        timestamp: new Date(),
      };
      await payment.save();

      return res.status(500).json({
        success: false,
        message: "Payment verification failed",
        error: error.message,
      });
    }
  } catch (error) {
    console.error("Payment verification route error:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
      details: error.stack,
    });
  }
});

// Add a payment polling endpoint
router.get("/poll-payment-status/:orderId", async (req, res) => {
  try {
    const updatedPayment = await verifyPaymentStatus(req.params.orderId);
    if (!updatedPayment) {
      return res.status(404).json({ error: "Payment not found" });
    }

    res.json({
      success: true,
      status: updatedPayment.status,
      payment: {
        orderId: updatedPayment.orderId,
        status: updatedPayment.status,
        amount: updatedPayment.amount,
        paymentMethod: updatedPayment.paymentMethod,
        lastVerificationTime: updatedPayment.lastVerificationTime,
      },
    });
  } catch (error) {
    console.error("Payment polling error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Add real-time webhooks handler
router.post("/razorpay-webhook", async (req, res) => {
  try {
    const webhook = req.body;
    const payment = await Payment.findOne({
      orderId: webhook.payload.payment.entity.order_id,
    });

    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }

    switch (webhook.event) {
      case "payment.authorized":
        payment.status = "processing";
        payment.transactionDetails = webhook.payload.payment.entity;
        break;

      case "payment.captured":
        payment.status = "completed";
        payment.transactionDetails = webhook.payload.payment.entity;
        break;

      case "payment.failed":
        payment.status = "failed";
        payment.error = {
          description: webhook.payload.payment.entity.error_description,
          code: webhook.payload.payment.entity.error_code,
          source: "razorpay_webhook",
          timestamp: new Date(),
        };
        break;
    }

    await payment.save();
    res.json({ success: true });
  } catch (error) {
    console.error("Webhook handling error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Cancel Payment
router.post("/cancel-payment", async (req, res) => {
  try {
    const { orderId, cancelledReason, timestamp } = req.body;

    const payment = await Payment.findOne({ orderId });
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    // Prevent cancellation of completed payments
    if (payment.status === "completed") {
      return res.status(400).json({
        success: false,
        message: "Cannot cancel completed payment",
      });
    }

    payment.status = "cancelled";
    payment.cancellation = {
      reason: cancelledReason,
      timestamp: timestamp || new Date(),
      initiatedBy: "user",
    };
    payment.updatedAt = new Date();

    await payment.save();

    // Update tournament registration if exists
    if (payment.eventId) {
      await Tournament.findByIdAndUpdate(payment.eventId, {
        $pull: {
          registrations: { paymentId: payment._id },
        },
      });
    }

    res.json({
      success: true,
      message: "Payment cancelled successfully",
    });
  } catch (error) {
    console.error("Payment cancellation error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get Payment Status
router.get("/payment-status/:orderId", async (req, res) => {
  try {
    console.log("Fetching payment status for order:", req.params.orderId);
    const payment = await Payment.findOne({
      orderId: req.params.orderId,
    }).populate("eventId", "title tournamentFee"); // Populate tournament details if needed

    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }

    res.json({
      success: true,
      payment,
    });
  } catch (error) {
    console.error("Failed to fetch payment status:", {
      message: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: error.message });
  }
});

// Get All Payments for a Tournament
router.get("/tournament-payments/:tournamentId", async (req, res) => {
  try {
    console.log("Fetching payments for tournament:", req.params.tournamentId);
    const payments = await Payment.find({
      eventId: req.params.tournamentId,
    }).sort({ createdAt: -1 }); // Most recent first

    res.json({
      success: true,
      payments,
    });
  } catch (error) {
    console.error("Failed to fetch tournament payments:", {
      message: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: error.message });
  }
});

// Get Payment Statistics
router.get("/payment-stats", async (req, res) => {
  try {
    const stats = await Payment.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
    ]);

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error("Failed to fetch payment statistics:", {
      message: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: error.message });
  }
});

// ===== TURF BOOKING: CREATE =====
router.post("/turf-bookings/create", async (req, res) => {
  try {
    const { userId, turfId, sportName, date, timeSlot } = req.body;

    if (!userId || !turfId || !sportName || !date || !timeSlot) {
      return res.status(400).json({
        success: false,
        message: "userId, turfId, sportName, date, and timeSlot are required",
      });
    }

    // Get turf details
    const turf = await Turf.findById(turfId);
    if (!turf) {
      return res.status(404).json({ success: false, message: "Turf not found" });
    }

    if (!turf.isActive) {
      return res.status(400).json({ success: false, message: "This turf is currently not available" });
    }

    // Get sport pricing
    const sport = turf.sports.find((s) => s.name === sportName);
    if (!sport) {
      return res.status(400).json({ success: false, message: `Sport "${sportName}" is not available at this turf` });
    }

    // Get user details
    const user = await User.findById(userId).select("name email mobile");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Parse booking date
    const bookingDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (bookingDate < today) {
      return res.status(400).json({ success: false, message: "Cannot book for a past date" });
    }

    // Atomic double-booking check — findOne + create in quick succession
    const existingBooking = await TurfBooking.findOne({
      turfId,
      date: {
        $gte: new Date(new Date(date).setHours(0, 0, 0, 0)),
        $lt: new Date(new Date(date).setHours(23, 59, 59, 999)),
      },
      timeSlot,
      status: { $in: ["pending", "confirmed"] },
    });

    if (existingBooking) {
      return res.status(409).json({
        success: false,
        message: "This time slot is already booked. Please select a different slot.",
      });
    }

    // Create the booking
    const booking = await TurfBooking.create({
      userId,
      userName: user.name,
      userEmail: user.email || "",
      userPhone: user.mobile || "",
      turfId,
      turfName: turf.name,
      sport: {
        name: sport.name,
        pricePerHour: sport.pricePerHour,
      },
      date: bookingDate,
      timeSlot,
      amount: sport.pricePerHour,
      status: "confirmed",
      paymentStatus: "pending",
      paymentMethod: "cash",
    });

    // Notify turf owner + assigned managers (socket + push)
    try {
      const formattedDate = new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
      const notifTitle = `New Booking — ${turf.name}`;
      const notifBody = `${user.name} booked ${sport.name} on ${formattedDate} (${timeSlot}) • ₹${sport.pricePerHour}`;

      // Collect all manager IDs (owner + assigned)
      const managerIds = new Set();
      if (turf.owner) managerIds.add(turf.owner.toString());
      if (turf.assignedManagers?.length > 0) {
        turf.assignedManagers.forEach((m) => managerIds.add(m.toString()));
      }

      // Emit socket event to each manager's room + their club admin (for web dashboard)
      const io = req.app.get("io");
      const managers = await Manager.find({ _id: { $in: [...managerIds] } }).select("expoPushToken clubId");
      const notifPayload = {
        title: notifTitle,
        message: notifBody,
        bookingId: booking._id.toString(),
        turfId,
        turfName: turf.name,
        playerName: user.name,
        sport: sport.name,
        date: formattedDate,
        timeSlot,
        amount: sport.pricePerHour,
      };

      if (io) {
        const notifiedClubAdmins = new Set();
        for (const mgrId of managerIds) {
          io.to(`user_${mgrId}`).emit("booking:new", notifPayload);
        }
        // Also notify club admins who own these managers
        for (const mgr of managers) {
          if (mgr.clubId && !notifiedClubAdmins.has(mgr.clubId.toString())) {
            io.to(`user_${mgr.clubId}`).emit("booking:new", notifPayload);
            notifiedClubAdmins.add(mgr.clubId.toString());
          }
        }
      }

      // Also send Expo push for mobile (if manager has mobile app)
      const { Expo } = require("expo-server-sdk");
      const expo = new Expo();
      const pushMessages = [];
      for (const mgr of managers) {
        if (mgr.expoPushToken && Expo.isExpoPushToken(mgr.expoPushToken)) {
          pushMessages.push({
            to: mgr.expoPushToken,
            title: notifTitle,
            body: notifBody,
            data: { type: "turf_booking", bookingId: booking._id.toString(), turfId },
            sound: "default",
          });
        }
      }
      if (pushMessages.length > 0) {
        await expo.sendPushNotificationsAsync(pushMessages);
      }
    } catch (pushErr) {
      console.error("[TURF_BOOKING] Notification error:", pushErr.message);
    }

    return res.status(201).json({
      success: true,
      message: "Booking created successfully",
      booking,
    });
  } catch (error) {
    console.error("Error creating turf booking:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create booking",
      error: error.message,
    });
  }
});

// ===== TURF BOOKING: CANCEL =====
router.post("/turf-bookings/cancel", async (req, res) => {
  try {
    const { bookingId, userId, reason } = req.body;

    if (!bookingId) {
      return res.status(400).json({ success: false, message: "bookingId is required" });
    }

    const booking = await TurfBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    // Verify ownership
    if (userId && booking.userId.toString() !== userId) {
      return res.status(403).json({ success: false, message: "You can only cancel your own bookings" });
    }

    if (booking.status === "cancelled") {
      return res.status(400).json({ success: false, message: "Booking is already cancelled" });
    }

    if (booking.status === "completed") {
      return res.status(400).json({ success: false, message: "Cannot cancel a completed booking" });
    }

    // Check cancellation deadline (at least 2 hours before booking)
    const bookingDateTime = new Date(booking.date);
    const slotStartHour = parseInt(booking.timeSlot.split(":")[0]);
    bookingDateTime.setHours(slotStartHour, 0, 0, 0);
    const hoursUntilBooking = (bookingDateTime - new Date()) / (1000 * 60 * 60);

    if (hoursUntilBooking < 2) {
      return res.status(400).json({
        success: false,
        message: "Cancellation must be at least 2 hours before the booking time",
      });
    }

    booking.status = "cancelled";
    booking.cancellationReason = reason || "Cancelled by user";
    booking.cancellationDate = new Date();
    await booking.save();

    // Notify turf owner about cancellation (socket + push)
    try {
      const turf = await Turf.findById(booking.turfId);
      if (turf) {
        const formattedDate = new Date(booking.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
        const notifTitle = `Booking Cancelled — ${turf.name}`;
        const notifBody = `${booking.userName} cancelled ${booking.sport?.name} on ${formattedDate} (${booking.timeSlot})`;

        const managerIds = new Set();
        if (turf.owner) managerIds.add(turf.owner.toString());
        if (turf.assignedManagers?.length > 0) {
          turf.assignedManagers.forEach((m) => managerIds.add(m.toString()));
        }

        // Emit socket event for web dashboard (managers + club admin)
        const io = req.app.get("io");
        const cancelNotifPayload = {
          title: notifTitle,
          message: notifBody,
          bookingId: booking._id.toString(),
          turfName: turf.name,
          playerName: booking.userName,
        };

        if (io) {
          for (const mgrId of managerIds) {
            io.to(`user_${mgrId}`).emit("booking:cancel", cancelNotifPayload);
          }
          // Notify club admins
          const cancelManagers = await Manager.find({ _id: { $in: [...managerIds] } }).select("clubId");
          const notifiedAdmins = new Set();
          for (const mgr of cancelManagers) {
            if (mgr.clubId && !notifiedAdmins.has(mgr.clubId.toString())) {
              io.to(`user_${mgr.clubId}`).emit("booking:cancel", cancelNotifPayload);
              notifiedAdmins.add(mgr.clubId.toString());
            }
          }
        }

        // Expo push for mobile
        const { Expo } = require("expo-server-sdk");
        const expo = new Expo();
        const managers = await Manager.find({ _id: { $in: [...managerIds] } }).select("expoPushToken");
        const pushMessages = [];
        for (const mgr of managers) {
          if (mgr.expoPushToken && Expo.isExpoPushToken(mgr.expoPushToken)) {
            pushMessages.push({
              to: mgr.expoPushToken,
              title: notifTitle,
              body: notifBody,
              data: { type: "turf_booking_cancel", bookingId: booking._id.toString() },
              sound: "default",
            });
          }
        }
        if (pushMessages.length > 0) {
          await expo.sendPushNotificationsAsync(pushMessages);
        }
      }
    } catch (pushErr) {
      console.error("[TURF_CANCEL] Notification error:", pushErr.message);
    }

    return res.json({
      success: true,
      message: "Booking cancelled successfully",
      booking,
    });
  } catch (error) {
    console.error("Error cancelling turf booking:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to cancel booking",
      error: error.message,
    });
  }
});

// ===== TURF BOOKING: MANAGER UPDATE STATUS (accept/reject/complete) =====
router.put("/turf-bookings/:bookingId/status", async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { status, reason } = req.body;

    if (!["confirmed", "cancelled", "completed"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be confirmed, cancelled, or completed",
      });
    }

    const booking = await TurfBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    booking.status = status;
    if (status === "cancelled") {
      booking.cancellationReason = reason || "Cancelled by manager";
      booking.cancellationDate = new Date();
    }
    await booking.save();

    return res.json({
      success: true,
      message: `Booking ${status} successfully`,
      booking,
    });
  } catch (error) {
    console.error("Error updating booking status:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update booking status",
      error: error.message,
    });
  }
});

module.exports = router;