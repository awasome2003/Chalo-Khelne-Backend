const Booking = require("../src/modules/tournaments/models/BookingModel");
const Payment = require("../src/modules/commerce/models/Payments");
const mongoose = require("mongoose");
const User = require("../src/modules/identity/models/User");
const Notification = require("../src/modules/social/models/Notification");
const Tournament = require("../src/modules/tournaments/models/Tournament");
const { validateTeamSize } = require("../utils/teamValidation");
const { assertSportSelections, handleSportContextError } = require("../middleware/requireSportContext");
const { eligibilityFor, findCategory } = require("../utils/eligibility");
const { redeemCoupon, CouponError } = require("../services/couponService");

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
        // paymentAmount is deliberately NOT destructured from the body any
        // more. The amount owed is _totalFee, derived from the tournament's
        // category fees. Re-adding it here is how §2.4 comes back.
        paymentMethod,
        tournamentType,
        selectedCategories,
        // Multi-sport: forward-looking shape. Either or both may be sent.
        // Accepted shape: [{ sportId, sportName, categoryName, fee }]
        sportSelections,
        // Coupon CODE only. The discount, the caps and the ledger amounts are
        // all derived server-side at redemption time (§2.7).
        couponCode,
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

      // Reject malformed ids early — a clean 400 instead of a Mongoose CastError 500.
      if (!mongoose.isValidObjectId(userId) || !mongoose.isValidObjectId(tournamentId)) {
        return res.status(400).json({ success: false, message: "Invalid userId or tournamentId" });
      }
      if (paymentId && !mongoose.isValidObjectId(paymentId)) {
        return res.status(400).json({ success: false, message: "Invalid paymentId" });
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

      // Block registrations after the registration deadline has passed.
      if (
        tournament &&
        tournament.registrationDeadline &&
        new Date() > new Date(tournament.registrationDeadline)
      ) {
        return res.status(403).json({
          success: false,
          message: "Registration for this tournament has closed.",
          code: "REGISTRATION_CLOSED",
        });
      }

      // Block booking a tournament that has already ended (e.g. opened from an
      // old notification). startDate/endDate are stored as strings.
      if (tournament && (tournament.endDate || tournament.startDate)) {
        const raw = tournament.endDate || tournament.startDate;
        let endDate;
        if (String(raw).includes("/")) {
          const [day, m, y] = String(raw).split("/").map(Number);
          endDate = new Date(y, m - 1, day);
        } else {
          endDate = new Date(raw);
        }
        if (!isNaN(endDate.getTime())) {
          endDate.setHours(23, 59, 59, 999);
          if (new Date() > endDate) {
            return res.status(403).json({
              success: false,
              message: "This tournament has already ended.",
              code: "TOURNAMENT_ENDED",
            });
          }
        }
      }

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
          return m.toString().replace(/[\s\-+]/g, "").slice(-10);
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
          // Doubles partner for THIS category. Validated against the
          // category's resolved format below; ignored for singles.
          partnerName: String(s.partnerName || "").trim() || null,
          partnerUserId:
            s.partnerUserId && mongoose.isValidObjectId(s.partnerUserId)
              ? s.partnerUserId
              : null,
          // NOTE: no `fee` here on purpose. It is resolved from the tournament
          // below — see the category-resolution pass. `s.fee` from the request
          // body is never read.
        };
      });

      // Age + gender eligibility check — authoritative gate. The mobile UI
      // greys out ineligible categories, but never trust the client. Runs
      // before payment so we don't have to refund anything on rejection.
      const eligibilityUser = await User.findById(userId)
        .select("dateOfBirth sex email mobile phone")
        .lean();
      if (!eligibilityUser) {
        return res.status(404).json({
          success: false,
          message: "Player profile not found",
        });
      }

      // ── Category resolution: price AND eligibility from the same lookup ────
      //
      // The fee used to be taken straight from req.body — `fee: Number(s.fee)`
      // — and summed into totalFee under a comment claiming it was
      // server-authoritative. A player could post fee: 1 for a ₹2,500 category
      // and the booking, the manager's payment notification and the club-admin
      // finance aggregate would all read ₹1 forever, because nothing
      // downstream ever re-derived the real price.
      //
      // findCategory() was already being called here for the eligibility gate
      // and the category object it returns carries the authoritative fee
      // (Tournament.js declares `fee` required on every category). It was used
      // for eligibility and thrown away. Now one pass does both.
      //
      // An unresolvable category is also now a hard reject. It used to
      // `continue`, which skipped the age/gender gate entirely for a category
      // name the tournament does not contain — and then let the client price it.
      const eligibilityFailures = [];
      const unknownCategories = [];
      try {
        _sportSelections = _sportSelections.map((sel) => {
          const category = findCategory(tournament, sel.sportId, sel.categoryName);
          if (!category) {
            unknownCategories.push({
              sportName: sel.sportName,
              categoryName: sel.categoryName,
            });
            return sel;
          }

          const result = eligibilityFor(eligibilityUser, category, tournament.startDate);
          if (!result.eligible) {
            eligibilityFailures.push({
              sportName: sel.sportName,
              categoryName: sel.categoryName,
              reason: result.reason,
            });
          }

          return { ...sel, fee: Number(category.fee ?? 0) };
        });
      } catch (err) {
        if (err.code === "TOURNAMENT_DATE_INVALID") {
          return res.status(500).json({
            success: false,
            message: "Tournament is misconfigured: start date is missing or invalid. Contact the organizer.",
          });
        }
        throw err;
      }

      if (unknownCategories.length > 0) {
        return res.status(400).json({
          success: false,
          message: "One or more selected categories do not exist in this tournament",
          unknownCategories,
        });
      }

      if (eligibilityFailures.length > 0) {
        return res.status(403).json({
          success: false,
          message: "Not eligible for one or more selected categories",
          ineligible: eligibilityFailures,
        });
      }

      // ── Doubles: a pair is ONE entrant, and a person enters a category once ──
      //
      // Two rules, both enforced here because the client cannot be trusted and
      // because a doubles entrant with no partner is unplayable: it reaches the
      // draw as a lone name with nobody to partner.
      //
      //   1. A doubles category requires a partner name.
      //   2. Neither half of the pair may already be in that category — whether
      //      they registered it themselves or were named as somebody else's
      //      partner. The existing-booking check above only catches the same
      //      userId booking twice; it cannot see a person named as a partner.
      //
      // "Doubles" is resolved per category, so Men's Doubles requires a partner
      // while Men's Singles in the same booking does not.
      {
        const { getGroupStageFormat, getKnockoutFormat } = require("../utils/sportTrackUtils");
        const { pairDisplayName, namesInEntry, normalizeName } = require("../utils/doublesPair");

        // A category played as doubles in EITHER stage must be entered as a
        // pair — a singles group stage that feeds a doubles knockout still
        // needs both names from the start.
        const requiresPartner = (sel) =>
          getGroupStageFormat(tournament, sel.sportId, sel.categoryName) === "Doubles" ||
          getKnockoutFormat(tournament, sel.sportId, sel.categoryName) === "Doubles";

        const doublesSelections = _sportSelections.filter(requiresPartner);

        const missingPartner = doublesSelections
          .filter((sel) => !sel.partnerName)
          .map((sel) => ({ sportName: sel.sportName, categoryName: sel.categoryName }));

        if (missingPartner.length > 0) {
          return res.status(400).json({
            success: false,
            message: "A partner is required to enter a doubles category",
            missingPartner,
          });
        }

        if (doublesSelections.length > 0) {
          // Who is already in each category, by (sportId, category).
          const catKey = (sportId, categoryName) =>
            `${String(sportId)}::${normalizeName(categoryName)}`;

          const existing = await Booking.find({ tournamentId })
            .select("userName sportSelections")
            .lean();

          const takenBy = new Map();
          for (const b of existing) {
            for (const s of b.sportSelections || []) {
              const key = catKey(s.sportId, s.categoryName);
              if (!takenBy.has(key)) takenBy.set(key, new Set());
              const people = takenBy.get(key);
              // Both halves of an existing entrant count as taken.
              for (const person of namesInEntry(pairDisplayName(b.userName, s.partnerName))) {
                people.add(person);
              }
            }
          }

          const conflicts = [];
          for (const sel of doublesSelections) {
            const people = takenBy.get(catKey(sel.sportId, sel.categoryName));
            if (!people) continue;
            for (const person of namesInEntry(pairDisplayName(userName, sel.partnerName))) {
              if (people.has(person)) {
                conflicts.push({
                  sportName: sel.sportName,
                  categoryName: sel.categoryName,
                  name: person,
                });
              }
            }
          }

          if (conflicts.length > 0) {
            return res.status(409).json({
              success: false,
              message:
                "Already entered in this category. A player can appear only once " +
                "per category, including as somebody else's partner.",
              conflicts,
            });
          }
        }

        // Singles entries never carry a partner, whatever the client sent.
        _sportSelections = _sportSelections.map((sel) =>
          requiresPartner(sel) ? sel : { ...sel, partnerName: null, partnerUserId: null }
        );
      }

      // totalFee is server-authoritative — every `fee` above came from
      // findCategory(), never from the request body.
      const _totalFee = _sportSelections.reduce(
        (sum, s) => sum + Number(s.fee),
        0
      );

      let bookingData = {
        userId,
        userName,
        // §5.4 — contact details come from the User record, not the request.
        //
        // The mobile app sends `userEmail: "player@example.com"` and
        // `userPhone: "N/A"` as defaults when the profile fields are missing.
        // Those placeholders were never written here at all (only the manager
        // bulk-upload path set these fields), so a manager looking at a
        // self-registered player's booking saw no contact details whatsoever.
        // Reading them from the account is both authoritative and immune to
        // whatever the client decided to send.
        userEmail: eligibilityUser.email || null,
        userPhone: eligibilityUser.mobile || eligibilityUser.phone || null,
        tournamentId,
        tournamentName,
        status: "pending",
        tournamentType,
        paymentMethod: normalizedPaymentMethod, // ✅ always set to cash if not sent
        paymentStatus: "pending",
        sportSelections: _sportSelections,
        totalFee: _totalFee,
        // Server-authoritative amount owed for this registration. Previously
        // left unset (defaulted to 0), which made club-admin finance revenue
        // read as 0. Free tournaments resolve to 0 via _totalFee.
        paymentAmount: _totalFee,
        employeeId: req.body.employeeId,
      };

      // Handle payment
      let paymentRecord;
      let newPayment = null; // a newly-created Payment to persist inside the transaction
      // "Is this free?" is decided by the server-derived total, not by the
      // client's paymentAmount — otherwise posting paymentAmount: 0 against a
      // paid tournament took the free-registration branch.
      if (_totalFee === 0 && normalizedPaymentMethod !== "cash") {
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
            // §3.10.4 — do NOT fabricate a gateway response.
            //
            // This used to write `gatewayResponse: { status: "success" }` for a
            // transaction that never happened, which is indistinguishable from
            // a real settlement to any future reconciliation job. A free
            // registration has no gateway leg at all, so the record says so.
            gatewayResponse: null,
            isSynthetic: true,
            syntheticReason: "free_tournament_no_gateway_transaction",
          },
        });

        newPayment = paymentRecord; // defer the write into the transaction below
        bookingData.paymentId = paymentRecord._id; // _id exists at instantiation
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

        // Augment booking with team data; persisted atomically below.
        bookingData = {
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
        };
      }

      // ── Atomic write ──────────────────────────────────────────────────
      // The (optional) new Payment and the Booking succeed together or not at
      // all. Previously these were two separate writes — a failed Booking save
      // left an orphaned Payment. The (userId, tournamentId) unique index also
      // turns a double-registration race into a clean 409 here.
      const session = await mongoose.startSession();
      try {
        let savedBooking;
        await session.withTransaction(async () => {
          // ── Coupon redemption (§2.7) ────────────────────────────────────
          // Evaluation and claim happen HERE, inside the booking transaction,
          // against the server-derived _totalFee. Previously the client called
          // /validate for a price and was trusted to call /record-usage
          // afterwards — two unlinked calls, so a coupon that was never
          // "recorded" stayed good forever, and the discount never reached the
          // booking at all.
          //
          // If the coupon is not redeemable, redeemCoupon throws and the whole
          // transaction aborts: no booking is created that believes it got a
          // discount it never claimed.
          if (couponCode) {
            const redemption = await redeemCoupon(
              {
                code: couponCode,
                userId, // from the token via forceSelfBody, never the body
                appliedTo: "tournament",
                appliedId: tournamentId,
                totalAmount: _totalFee,
              },
              { session }
            );

            bookingData.coupon = {
              couponId: redemption.couponId,
              code: redemption.code,
              discountAmount: redemption.discountAmount,
              usageId: redemption.usageId,
            };
            // totalFee stays the pre-discount price; paymentAmount is what the
            // player actually owes.
            bookingData.paymentAmount = redemption.finalAmount;
          }

          if (newPayment) await newPayment.save({ session });
          const booking = new Booking(bookingData);
          await booking.save({ session });
          savedBooking = booking;
        });
        return res.status(201).json({
          success: true,
          message: "Tournament registration confirmed",
          booking: savedBooking.toObject(),
        });
      } catch (txErr) {
        // Duplicate-registration unique index (E11000) → friendly 409.
        if (txErr && txErr.code === 11000) {
          return res.status(409).json({
            success: false,
            message: "You have already registered for this tournament",
          });
        }
        // A rejected coupon is the player's problem to fix, not a 500.
        if (txErr instanceof CouponError) {
          return res.status(400).json({
            success: false,
            message: txErr.message,
            code: txErr.code,
          });
        }
        throw txErr; // other errors handled by the outer catch (500)
      } finally {
        session.endSession();
      }
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
      if (!mongoose.isValidObjectId(userId) || !mongoose.isValidObjectId(tournamentId)) {
        return res.status(400).json({ success: false, message: "Invalid userId or tournamentId" });
      }
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
      if (!mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ success: false, message: "Invalid userId" });
      }

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
      if (!mongoose.isValidObjectId(tournamentId)) {
        return res.status(400).json({ success: false, message: "Invalid tournamentId" });
      }
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
      if (!mongoose.isValidObjectId(tournamentId) || !mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ success: false, message: "Invalid tournamentId or userId" });
      }

      // Ownership: the caller (managerAuth) must manage this tournament.
      const callerId = String(req.user?.id || req.user?._id || "");
      const ownTour = await Tournament.findById(tournamentId).select("managerId").lean();
      if (!ownTour) {
        return res.status(404).json({ success: false, message: "Tournament not found" });
      }
      if (!(ownTour.managerId || []).some((m) => String(m) === callerId)) {
        return res.status(403).json({ success: false, message: "Forbidden: not your tournament" });
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

      // updateMany, not findOneAndUpdate: /notify used to mint a row per call,
      // so a (tournament, player) pair can hold several notifications. Matching
      // one of them left the rest pending — the manager pressed Accept, the row
      // they pressed it on stayed put, and a second identical row still asked
      // to be decided. Every copy of this registration moves together.
      await Notification.updateMany(
        { tournamentId, userId },
        { $set: { transactionStatus: decision } }
      );

      // Notify player about registration status change
      try {
        const { notifyPlayer } = require("../utils/playerNotify");
        const Tournament = require("../src/modules/tournaments/models/Tournament");
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

      // Ownership: the caller must manage EVERY tournament referenced in the batch.
      const callerId = String(req.user?.id || req.user?._id || "");
      const tournamentIds = [...new Set(items.map((i) => i.tournamentId).filter(Boolean).map(String))];
      const owned = await Tournament.find({ _id: { $in: tournamentIds }, managerId: callerId })
        .select("_id")
        .lean();
      if (owned.length !== tournamentIds.length) {
        return res.status(403).json({ success: false, message: "Forbidden: one or more tournaments are not yours" });
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

      // Check for existing bookings in this tournament to avoid duplicates.
      // Employee ID is the strong key when present — two genuinely different
      // people can share a name, and name-only dedupe silently dropped one.
      //
      // Doubles pairs register as a single booking named "A & B". The same pair
      // can legitimately be typed either way round, so the name key sorts the
      // partners: without it, "Rahul & Amit" and "Amit & Rahul" are two
      // bookings and the pair enters the bracket twice. Mirrors entryKey() in
      // sports_app/src/Manager/bulkParse.js.
      // utils/doublesPair owns this — it was duplicated here and as entryKey()
      // in sports_app/src/Manager/bulkParse.js, and the two had to be kept in
      // step by hand.
      const { pairKey: nameKey } = require("../utils/doublesPair");

      const existingBookings = await Booking.find({ tournamentId });
      const existingNames = new Set(existingBookings.map(b => nameKey(b.userName)));
      const existingEmpIds = new Set(
        existingBookings.map(b => (b.employeeId || "").trim().toLowerCase()).filter(Boolean)
      );

      const created = [];
      const skipped = [];
      const toInsert = [];

      for (const player of players) {
        const name = (player.name || "").trim();
        if (!name) {
          skipped.push({ ...player, reason: "Name is required" });
          continue;
        }

        // Skip duplicates — by employee ID when the row has one, else by name.
        const rowEmpId = (player.employeeId || "").trim().toLowerCase();
        if (rowEmpId) {
          if (existingEmpIds.has(rowEmpId)) {
            skipped.push({ ...player, reason: "Already registered (employee ID)" });
            continue;
          }
        } else if (existingNames.has(nameKey(name))) {
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
        // Per-row sport: the Excel `Sport` column picks which of the
        // tournament's sports this registration belongs to, matched by name
        // (case/space-insensitive). Rows with no Sport value — and
        // single-sport tournaments — fall back to sports[0].
        //
        // This matters beyond convenience: the knockout player picker filters
        // registrants by the ACTIVE sport, so hard-coding sports[0] made
        // bulk-uploaded players invisible whenever the manager was building a
        // bracket for any other sport.
        const allSports = Array.isArray(tournament.sports) ? tournament.sports : [];
        const _norm = (s) => String(s || "").toLowerCase().replace(/[\s_-]+/g, "");
        let track0 = allSports.length > 0 ? allSports[0] : null;
        if (player.sport && allSports.length > 0) {
          const wanted = _norm(player.sport);
          const matchedSport = allSports.find((s) => _norm(s.sportName) === wanted);
          if (matchedSport) track0 = matchedSport;
        }

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

        // Seeding rank from the Excel `Seed` column. Only positive integers
        // count; anything else means unseeded.
        const seedRaw = Number(player.seed);
        const seed = Number.isFinite(seedRaw) && seedRaw > 0 ? Math.floor(seedRaw) : null;

        toInsert.push({
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
          seed,
          isGuestBooking: true,
          sportSelections,
          totalFee,
          team: teamData,
        });

        // Reserve the keys so duplicates WITHIN this upload are caught too.
        existingNames.add(nameKey(name));
        if (rowEmpId) existingEmpIds.add(rowEmpId);
      }

      // Single batched write instead of one round trip per player — a 128-row
      // sheet was 128 sequential saves. tenantScope stamps clubId via its
      // pre("insertMany") hook, so tenancy behaviour is unchanged.
      if (toInsert.length > 0) {
        const inserted = await Booking.insertMany(toInsert);
        inserted.forEach((b) => {
          created.push({
            _id: b._id,
            userName: b.userName,
            userEmail: b.userEmail,
            employeeId: b.employeeId,
            seed: b.seed,
          });
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
