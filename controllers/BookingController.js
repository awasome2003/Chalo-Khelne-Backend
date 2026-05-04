const Booking = require("../Modal/BookingModel");
const Payment = require("../Modal/Payments");
const mongoose = require("mongoose");
const User = require("../Modal/User");
const Notification = require("../Modal/Notification");
const Tournament = require("../Modal/Tournament");
const { validateTeamSize } = require("../utils/teamValidation");
const { assertSportSelections, handleSportContextError } = require("../middleware/requireSportContext");

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
        // Multi-sport: forward-looking shape. Either or both may be sent.
        // Accepted shape: [{ sportId, sportName, categoryName, fee }]
        sportSelections,
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

      // STEP 16c — sportSelections is now required at the API boundary.
      // Reject legacy `selectedCategories`-only payloads up front.
      let _sportSelections;
      try {
        _sportSelections = assertSportSelections(req.body);
      } catch (err) {
        if (handleSportContextError(err, res)) return;
        throw err;
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
      const tournament = await Tournament.findById(tournamentId);

      if (tournament && tournament.whitelist && tournament.whitelist.length > 0) {
        // Fetch user's mobile if not provided in request
        let userMobile = req.body.userPhone || req.body.mobile;
        if (!userMobile) {
          const userDoc = await User.findById(userId);
          userMobile = userDoc?.mobile || userDoc?.phone;
        }

        const employeeId = req.body.employeeId;

        // Normalize mobile — strip +, spaces, dashes, country code — keep last 10 digits
        const normalizeMobile = (m) => {
          if (!m) return "";
          return m.toString().replace(/[\s\-\+]/g, "").slice(-10);
        };

        const isWhitelisted = tournament.whitelist.some(emp => {
          const idMatch = employeeId && emp.employeeId &&
            emp.employeeId.toString().trim().toLowerCase() === employeeId.toString().trim().toLowerCase();
          const mobileMatch = userMobile && emp.mobile &&
            normalizeMobile(emp.mobile) === normalizeMobile(userMobile);
          return idMatch || mobileMatch;
        });

        if (!isWhitelisted) {
          return res.status(403).json({
            success: false,
            message: "This is a restricted corporate tournament. Only authorized employees can register. If you are an employee, please ensure your Employee ID or mobile number matches the company list."
          });
        }
      }

      // Check for existing booking.
      //
      // STEP 12 v1 LIMITATION (revisit in v2): in a multi-sport tournament,
      // the player must pick ALL their sport+category entries up front in
      // their first booking. Once a booking exists, additional sports
      // cannot be added later — re-submission is blocked by this check.
      // To support "add another sport to my existing booking", the v2
      // model would either:
      //   (a) merge new sportSelections into existingBooking.sportSelections
      //       (and bump totalFee + create a follow-up payment), or
      //   (b) allow multiple Booking docs per (userId, tournamentId) keyed
      //       on (userId, tournamentId, sportId) and aggregate downstream.
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

      // STEP 17c — sportSelections is the only shape written. Legacy
      // `selectedCategories` dual-write removed (kept since STEP 9c).
      // Backfill missing sportId/sportName per entry from the tournament
      // so downstream readers always see a populated track ref. The
      // resolveSportId helper accepts both string and ObjectId-shaped
      // inputs; Mongoose casts at save time. Legacy `tournament.sportsType`
      // fallback removed — sports[0].sportName is the only source.
      const { resolveSportId } = require("../utils/sportTrackUtils");
      _sportSelections = _sportSelections.map((s) => {
        const resolvedSportId = s.sportId
          ? s.sportId
          : resolveSportId(tournament, req.body.sportId);
        const resolvedSportName = s.sportName
          || tournament?.sports?.[0]?.sportName
          || null;
        return {
          sportId: resolvedSportId,
          sportName: resolvedSportName,
          categoryName: s.categoryName,
          fee: Number(s.fee),
        };
      });

      // totalFee is server-authoritative — sum of sportSelections.fee.
      const _totalFee = _sportSelections.reduce(
        (sum, s) => sum + Number(s.fee),
        0
      );

      let bookingData = {
        userId,
        userName,
        tournamentId,
        tournamentName,
        status: "pending",
        tournamentType,
        paymentMethod: normalizedPaymentMethod, // ✅ always set to cash if not sent
        paymentStatus: "pending",
        sportSelections: _sportSelections,
        totalFee: _totalFee,
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
      } else if (normalizedPaymentMethod === "online" && !paymentId) {
        // Online payment with manual transaction ID (UPI/bank transfer) — pending verification
        bookingData.paymentMethod = "online";
        bookingData.paymentStatus = "pending";
        bookingData.status = "pending";
        bookingData.transactionId = req.body.transactionId || null;
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

        // Sport-aware team size validation — STEP 17b.iv: per-sport name.
        try {
          const tournament = await Tournament.findById(tournamentId).lean();
          const { getSportName } = require("../utils/sportTrackUtils");
          const sportName = getSportName(tournament, req.body.sportId);
          const playerCount = (team.players || []).length + (team.captain ? 1 : 0);
          if (sportName && playerCount > 0) {
            const teamCheck = validateTeamSize(playerCount, sportName);
            if (!teamCheck.valid) {
              return res.status(400).json({
                success: false,
                message: teamCheck.error,
              });
            }
          }
        } catch (validationErr) {
          console.warn("[BOOKING] Team size validation skipped:", validationErr.message);
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

      // Notify player about registration status change
      try {
        const { notifyPlayer } = require("../utils/playerNotify");
        const Tournament = require("../Modal/Tournament");
        const tournament = await Tournament.findById(tournamentId).select("title").lean();
        const tName = tournament?.title || "Tournament";

        await notifyPlayer(req.app, userId, {
          type: decision === "accepted" ? "registration_accepted" : "registration_rejected",
          title: decision === "accepted" ? `Registration Confirmed` : `Registration Rejected`,
          message: decision === "accepted"
            ? `Your registration for "${tName}" has been confirmed!`
            : `Your registration for "${tName}" has been rejected.`,
          data: { tournamentId, tournamentName: tName },
        });
      } catch (notifErr) {
        console.error("[BOOKING_STATUS_NOTIFY] Error:", notifErr.message);
      }

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

  // Bulk create bookings from manager's Excel upload (guest bookings — no user accounts)
  bulkCreateBookings: async (req, res) => {
    try {
      const { tournamentId, players } = req.body;

      if (!tournamentId || !Array.isArray(players) || players.length === 0) {
        return res.status(400).json({
          success: false,
          message: "tournamentId and a non-empty players array are required",
        });
      }

      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        return res.status(404).json({ success: false, message: "Tournament not found" });
      }

      const tournamentType = tournament.type || "knockout";

      // Check for existing bookings in this tournament to avoid duplicates
      const existingBookings = await Booking.find({ tournamentId });
      const existingNames = new Set(existingBookings.map(b => b.userName?.toLowerCase().trim()));

      const created = [];
      const skipped = [];

      for (const player of players) {
        const name = (player.name || "").trim();
        if (!name) {
          skipped.push({ ...player, reason: "Name is required" });
          continue;
        }

        // Skip duplicates
        if (existingNames.has(name.toLowerCase())) {
          skipped.push({ ...player, reason: "Already registered" });
          continue;
        }

        // Auto-generate email if not provided
        let email = (player.email || "").trim();
        if (!email) {
          const slug = name.toLowerCase().replace(/[^a-z0-9]/g, ".").replace(/\.+/g, ".").replace(/^\.+|\.+$/g, "");
          const rand = Math.floor(1000 + Math.random() * 9000);
          email = `${slug}.${rand}@chalokhelne.local`;
        }

        const phone = (player.phone || player.mobile || "").trim() || null;
        const employeeId = (player.employeeId || "").trim() || null;

        // STEP 16c — bulk path now writes both shapes.
        // Resolve the matching category from sports[0] (multi-sport
        // canonical) with a legacy tournament.category fallback for
        // any pre-migration tournament that somehow slipped through.
        // Multi-sport bulk upload (per-row sport selection) is a
        // separate feature — for now bulk uses sports[0] uniformly.
        const track0 = Array.isArray(tournament.sports) && tournament.sports.length > 0
          ? tournament.sports[0]
          : null;

        // STEP 17c — read categories off sports[0] only. Legacy
        // tournament.category fallback removed; every tournament has
        // sports[] populated post-STEP-16.
        const sportCats = Array.isArray(track0?.categories) ? track0.categories : [];

        // Pick the matched category (by player.category) or fall back
        // to the first available.
        let matchedSportCat = null;
        if (player.category) {
          const lc = player.category.toLowerCase();
          matchedSportCat = sportCats.find((c) => (c.name || "").toLowerCase() === lc) || null;
        }
        if (!matchedSportCat && sportCats.length > 0) matchedSportCat = sportCats[0];

        // Build sportSelections from matched sport-category. Skip legacy
        // selectedCategories write entirely.
        let sportSelections = [];
        let totalFee = 0;
        if (matchedSportCat && track0) {
          const fee = Number(matchedSportCat.fee ?? 0);
          sportSelections = [{
            sportId: track0.sportId || null,
            sportName: track0.sportName || null,
            categoryName: matchedSportCat.name,
            fee,
          }];
          totalFee = fee;
        }

        // Build team data only for team-format tournaments.
        // STEP 17c — read formats off sports[0] (the canonical source).
        let teamData = undefined;
        const _isTeamTournamentTrack0 = (Array.isArray(tournament.sports) && tournament.sports.length > 0)
          ? tournament.sports[0]
          : null;
        const isTeamTournament = ["Teams", "Teams Knockout", "Davis Cup"].includes(_isTeamTournamentTrack0?.knockoutFormat) ||
          _isTeamTournamentTrack0?.groupStageFormat === "Teams";

        if (isTeamTournament && player.teamName) {
          const teamPlayers = Array.isArray(player.teamPlayers)
            ? player.teamPlayers.map(p => ({ name: typeof p === "string" ? p : p.name }))
            : [];
          const teamSubs = Array.isArray(player.teamSubstitutes)
            ? player.teamSubstitutes.map(s => ({ name: typeof s === "string" ? s : s.name }))
            : [];

          teamData = {
            name: player.teamName,
            captain: { name },
            players: teamPlayers,
            substitutes: teamSubs,
          };
        }

        const booking = new Booking({
          userId: null,
          userName: name,
          userEmail: email,
          userPhone: phone,
          tournamentId,
          tournamentName: tournament.title || "Tournament",
          tournamentType,
          status: "confirmed",
          paymentStatus: "waived",
          paymentAmount: 0,
          paymentMethod: "cash",
          employeeId,
          isGuestBooking: true,
          sportSelections,
          totalFee,
          team: teamData,
        });

        await booking.save();
        existingNames.add(name.toLowerCase());
        created.push({
          _id: booking._id,
          userName: booking.userName,
          userEmail: booking.userEmail,
          employeeId: booking.employeeId,
        });
      }

      res.status(201).json({
        success: true,
        message: `${created.length} bookings created, ${skipped.length} skipped`,
        created,
        skipped,
        total: created.length,
      });
    } catch (error) {
      console.error("Bulk create bookings error:", error.message);
      res.status(500).json({
        success: false,
        message: "Failed to create bulk bookings",
        error: error.message,
      });
    }
  },
};

module.exports = bookingController;
