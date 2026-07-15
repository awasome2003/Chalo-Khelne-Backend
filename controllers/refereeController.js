const mongoose = require("mongoose");
const Referee = require("../src/modules/catalog/models/Referee");
const User = require("../src/modules/identity/models/User");
const TeamKnockout = require("../src/modules/tournaments/models/TeamKnockoutMatches"); // Updated to use TeamKnockout instead of Match
const Assignment = require("../src/modules/tournaments/models/Assignment");
const { cleanupFile } = require("../middleware/uploads");
const path = require("path");

// Get referee profile
// Behavior: by default returns 404 if no profile exists.
// Pass ?createIfMissing=true to opt into auto-create (used by "Become a Referee" flow).
// This prevents side-effect creation from role-probing GETs (e.g., RoleHub).
exports.getRefereeProfile = async (req, res) => {
  try {
    // Check if the user exists
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Try to find the referee profile
    let referee = await Referee.findOne({ userId: req.params.id });

    // If no referee profile exists, create a new one
    if (!referee) {
      // Opt-in creation: caller must explicitly request it.
      if (req.query.createIfMissing !== "true") {
        return res.status(404).json({ message: "Referee profile not found" });
      }

      // Split name or use defaults
      const nameParts = user.name
        ? user.name.split(" ")
        : ["Unnamed", "Referee"];
      const firstName = nameParts[0];
      const lastName =
        nameParts.length > 1 ? nameParts[nameParts.length - 1] : "Referee";

      referee = new Referee({
        userId: req.params.id,
        firstName: firstName,
        lastName: lastName,
        certificates: [],
        experience: 0,
      });

      await referee.save();
    }

    // Populate userId with full user details
    await referee.populate("userId", "name email mobile profileImage");

    res.json(referee);
  } catch (error) {
    console.error("Error fetching referee profile:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update referee profile
exports.updateRefereeProfile = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      dob,
      gender,
      sport,
      experience,
      address,
      emergencyContact,
      emergencyContactName,
      certificationLevel,
      sports,
      about,
      bio,
    } = req.body;

    let referee = await Referee.findOne({ userId: req.params.id });

    if (!referee) {
      // Create a new referee profile if it doesn't exist
      referee = new Referee({
        userId: req.params.id,
        firstName,
        lastName,
        dob,
        gender,
        sport,
        sports,
        experience,
        address,
        emergencyContact,
        emergencyContactName,
        certificationLevel,
        about,
        bio,
      });
    } else {
      // Update existing referee profile
      referee.firstName = firstName || referee.firstName;
      referee.lastName = lastName || referee.lastName;
      referee.dob = dob || referee.dob;
      referee.gender = gender || referee.gender;
      referee.sport = sport || referee.sport;
      referee.sports = sports || referee.sports;
      referee.experience = experience || referee.experience;
      referee.address = address || referee.address;
      referee.emergencyContact = emergencyContact || referee.emergencyContact;
      referee.emergencyContactName =
        emergencyContactName || referee.emergencyContactName;
      referee.certificationLevel =
        certificationLevel || referee.certificationLevel;
      referee.about = about || referee.about;
      referee.bio = bio || referee.bio;
    }

    await referee.save();

    res.json(referee);
  } catch (error) {
    console.error("Error updating referee profile:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Add certificate
exports.addCertificate = async (req, res) => {
  try {
    const { name, issuedBy, issueDate, expiryDate, certificateId } = req.body;

    // Certificate URL: from file upload (multer) OR from body
    const certificateUrl = req.file
      ? `uploads/certificates/${req.file.filename}`
      : req.body.certificateUrl || null;

    const referee = await Referee.findOne({ userId: req.params.id });

    if (!referee) {
      return res.status(404).json({ message: "Referee profile not found" });
    }

    referee.certificates.push({
      name: name || req.file?.originalname || "Document",
      issuedBy,
      issueDate,
      expiryDate,
      certificateId,
      certificateUrl,
    });

    await referee.save();

    res.json(referee.certificates);
  } catch (error) {
    console.error("Error adding certificate:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Remove certificate
exports.removeCertificate = async (req, res) => {
  try {
    const referee = await Referee.findOne({ userId: req.params.id });

    if (!referee) {
      return res.status(404).json({ message: "Referee profile not found" });
    }

    const certIndex = referee.certificates.findIndex(
      (cert) => cert._id.toString() === req.params.certId
    );

    if (certIndex === -1) {
      return res.status(404).json({ message: "Certificate not found" });
    }

    referee.certificates.splice(certIndex, 1);
    await referee.save();

    res.json(referee.certificates);
  } catch (error) {
    console.error("Error removing certificate:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get referee's upcoming assignments
exports.getRefereeAssignments = async (req, res) => {
  try {
    // First check referee assignments
    const assignments = await Assignment.find({
      refereeId: req.params.id,
    })
      .populate("tournamentId")
      .sort({ date: 1 });

    // Also get matches from TeamKnockout that have this referee assigned
    const matches = await TeamKnockout.find({
      $or: [
        { "matches.refereeId": req.params.id },
        { refereeId: req.params.id }, // In case refereeId is at the top level
      ],
    }).populate("tournamentId");

    // Format match data to match assignment structure
    const formattedMatches = matches.map((match) => {
      return {
        id: match._id,
        title:
          match.team1?.name + " vs " + match.team2?.name || "Tournament Match",
        type: "Match",
        date: match.matchStartTime
          ? new Date(match.matchStartTime)
          : new Date(),
        startTime: match.matchStartTime || "TBD",
        endTime: match.matchStartTime ? "TBD" : "TBD", // Calculate from matchInterval if available
        location: match.courtNumber || "TBD",
        matches: 1,
        status:
          match.status === "SCHEDULED"
            ? "pending"
            : match.status === "COMPLETED"
            ? "completed"
            : "pending",
        tournamentId: match.tournamentId,
      };
    });

    // Combine both types of assignments
    const allAssignments = [...assignments, ...formattedMatches];

    res.json(allAssignments);
  } catch (error) {
    console.error("Error fetching referee assignments:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get referee's completed assignments
exports.getCompletedAssignments = async (req, res) => {
  try {
    // Get completed assignments
    const assignments = await Assignment.find({
      refereeId: req.params.id,
      status: "completed",
    })
      .populate("tournamentId")
      .sort({ date: -1 });

    // Get completed matches
    const matches = await TeamKnockout.find({
      $or: [
        { "matches.refereeId": req.params.id, status: "COMPLETED" },
        { refereeId: req.params.id, status: "COMPLETED" },
      ],
    }).populate("tournamentId");

    // Format match data
    const formattedMatches = matches.map((match) => {
      return {
        id: match._id,
        title:
          match.team1?.name + " vs " + match.team2?.name || "Tournament Match",
        type: "Match",
        date: match.matchStartTime
          ? new Date(match.matchStartTime)
          : new Date(),
        startTime: match.matchStartTime || "TBD",
        endTime: "TBD",
        location: match.courtNumber || "TBD",
        matches: 1,
        status: "completed",
        tournamentId: match.tournamentId,
        result: match.winningTeam
          ? `Winner: ${match.winningTeam.name}`
          : "No result",
      };
    });

    // Combine both types of assignments
    const allCompletedAssignments = [...assignments, ...formattedMatches];

    res.json(allCompletedAssignments);
  } catch (error) {
    console.error("Error fetching completed assignments:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Accept an assignment
exports.acceptAssignment = async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.assignmentId);

    if (!assignment) {
      // Check if it's a TeamKnockout match
      const match = await TeamKnockout.findById(req.params.assignmentId);

      if (!match) {
        return res.status(404).json({ message: "Assignment not found" });
      }

      // Update match status in TeamKnockout
      match.status = "ACCEPTED"; // Use appropriate status field
      await match.save({ validateModifiedOnly: true });

      return res.json(match);
    }

    if (assignment.refereeId.toString() !== req.params.id) {
      return res
        .status(403)
        .json({ message: "Not authorized to accept this assignment" });
    }

    assignment.status = "accepted";
    await assignment.save();

    res.json(assignment);
  } catch (error) {
    console.error("Error accepting assignment:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Decline an assignment
exports.declineAssignment = async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.assignmentId);

    if (!assignment) {
      // Check if it's a TeamKnockout match
      const match = await TeamKnockout.findById(req.params.assignmentId);

      if (!match) {
        return res.status(404).json({ message: "Assignment not found" });
      }

      // Update match status in TeamKnockout
      match.status = "DECLINED"; // Use appropriate status field
      await match.save({ validateModifiedOnly: true });

      return res.json(match);
    }

    if (assignment.refereeId.toString() !== req.params.id) {
      return res
        .status(403)
        .json({ message: "Not authorized to decline this assignment" });
    }

    assignment.status = "declined";
    await assignment.save();

    res.json(assignment);
  } catch (error) {
    console.error("Error declining assignment:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// List umpires who applied to officiate a tournament (Phase 1 — manager view).
// Sources from StaffApplication (role="referee") — the canonical apply record.
// Default: returns status="pending" only (new applicants).
// ?includeAll=true → returns pending + accepted (full active staffing).
exports.getTournamentApplicants = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const includeAll = req.query.includeAll === "true";

    if (!mongoose.Types.ObjectId.isValid(tournamentId)) {
      return res.status(400).json({ message: "Invalid tournamentId" });
    }

    const Tournament = require("../src/modules/tournaments/models/Tournament");
    const tournament = await Tournament.findById(tournamentId).select(
      "title sportsType"
    );
    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    const StaffApplication = require("../src/modules/social/models/StaffApplication");

    const statusFilter = includeAll
      ? { $in: ["pending", "accepted"] }
      : "pending";

    const applicants = await StaffApplication.aggregate([
      {
        $match: {
          tournamentId: new mongoose.Types.ObjectId(tournamentId),
          role: "referee",
          status: statusFilter,
        },
      },
      // Enrich with Referee profile for certificationLevel + legal name
      {
        $lookup: {
          from: "referees",
          localField: "userId",
          foreignField: "userId",
          as: "_profile",
        },
      },
      { $unwind: { path: "$_profile", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          applicationId: "$_id",
          status: 1,
          notes: "$message",
          appliedAt: "$createdAt",
          rateAmount: 1,
          rateType: 1,
          referee: {
            userId: "$userId",
            name: "$userName",
            email: "$userEmail",
            profileImage: "$userProfileImage",
            certificationLevel: "$_profile.certificationLevel",
            experience: { $ifNull: ["$_profile.experience", "$experience"] },
            sports: { $ifNull: ["$_profile.sports", "$sports"] },
            firstName: "$_profile.firstName",
            lastName: "$_profile.lastName",
          },
        },
      },
      { $sort: { appliedAt: -1 } },
    ]);

    // STEP 17b.iii — emit only `sportName`. Legacy `sportsType` alias
    // dropped after mobile-side grep confirmed zero consumers.
    const { getSportName } = require("../utils/sportTrackUtils");
    return res.status(200).json({
      tournament: {
        _id: tournament._id,
        title: tournament.title,
        sportName: getSportName(tournament),
      },
      count: applicants.length,
      applicants,
    });
  } catch (error) {
    console.error("getTournamentApplicants error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Manager assigns an umpire to a specific match (Phase 1).
// Writes match.referee AND creates a match-level Assignment (status="pending").
// The umpire then uses accept/declineAssignment to confirm.
exports.assignUmpireToMatch = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { refereeUserId, paymentAmount, notes } = req.body;

    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({ message: "Invalid matchId" });
    }
    if (!refereeUserId || !mongoose.Types.ObjectId.isValid(refereeUserId)) {
      return res
        .status(400)
        .json({ message: "refereeUserId is required and must be valid" });
    }

    // Load match from whichever schema holds it
    const Match = require("../src/modules/tournaments/models/Tournnamentmatch");
    const DirectKnockoutMatch = require("../src/modules/tournaments/models/DirectKnockoutMatch");
    const TeamKnockoutMatches = require("../src/modules/tournaments/models/TeamKnockoutMatches");
    let match = await Match.findById(matchId);
    let matchKind = "Match";
    if (!match) {
      match = await DirectKnockoutMatch.findById(matchId);
      matchKind = "DirectKnockoutMatch";
    }
    if (!match) {
      match = await TeamKnockoutMatches.findById(matchId);
      matchKind = "TeamKnockoutMatches";
    }
    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    // Guard: match not completed
    if (match.status === "COMPLETED" || match.status === "completed") {
      return res
        .status(400)
        .json({ message: "Cannot assign umpire to a completed match" });
    }

    // Guard: match doesn't already have an umpire assigned.
    // Schema shape varies:
    //   group-stage Match: nested { refereeId, name, contact } — may be empty-initialized with null fields
    //   DirectKnockoutMatch: bare ObjectId ref
    // Only reject if a non-null refereeId is actually present.
    const existingRef =
      match.referee && typeof match.referee === "object"
        ? match.referee.refereeId // nested shape — only the id matters
        : match.referee; // bare ObjectId (or null)
    if (existingRef) {
      return res.status(400).json({
        message: "Match already has an umpire assigned. Unassign first.",
        currentReferee: existingRef,
      });
    }

    // Validate umpire has a referee profile
    const referee = await Referee.findOne({ userId: refereeUserId });
    if (!referee) {
      return res
        .status(404)
        .json({ message: "Umpire has no referee profile" });
    }
    const user = await User.findById(refereeUserId).select("name email");
    if (!user) {
      return res.status(404).json({ message: "Umpire user not found" });
    }

    // Tournament for assignment title
    const Tournament = require("../src/modules/tournaments/models/Tournament");
    const tournament = await Tournament.findById(match.tournamentId).select(
      "title"
    );

    // Assignment schema requires date/startTime/endTime/location for type="Match".
    // Source them from the match doc (manager can edit later via updateAssignment).
    const startTime = match.matchStartTime || match.startTime || match.matchDate || new Date();
    const startTimeStr = new Date(startTime).toISOString();
    const courtNumber = match.courtNumber
      ? `Court ${match.courtNumber}`
      : "TBD";

    // Create match-level assignment
    const assignment = new Assignment({
      title: `${tournament?.title || "Tournament"} — ${match.round || "Match " + (match.matchNumber || match.bracketPosition || "")}`,
      type: "Match",
      refereeId: refereeUserId,
      tournamentId: match.tournamentId,
      matchId: match._id,
      date: startTime,
      startTime: startTimeStr,
      endTime: startTimeStr, // manager can edit later
      location: courtNumber,
      status: "pending",
      paymentAmount: paymentAmount || undefined,
      notes: notes || undefined,
    });
    await assignment.save();

    // Write match.referee — shape differs between schemas
    if (matchKind === "Match" || matchKind === "TeamKnockoutMatches") {
      // group-stage + team-knockout schema: nested object { refereeId, name }
      match.referee = {
        refereeId: refereeUserId,
        name: user.name,
      };
    } else {
      // DirectKnockoutMatch: ObjectId ref directly
      match.referee = refereeUserId;
    }
    await match.save({ validateModifiedOnly: true });

    // Mark the source StaffApplication as accepted (if umpire applied through
    // the staff-applications flow). Idempotent: only updates pending → accepted.
    // Silent on "no application" — managers may assign umpires directly without prior application.
    let staffApplicationUpdated = false;
    try {
      const StaffApplication = require("../src/modules/social/models/StaffApplication");
      const result = await StaffApplication.updateOne(
        {
          userId: refereeUserId,
          tournamentId: match.tournamentId,
          role: "referee",
          status: "pending",
        },
        {
          $set: {
            status: "accepted",
            respondedAt: new Date(),
          },
        }
      );
      staffApplicationUpdated = result.modifiedCount > 0;
    } catch (saErr) {
      // Don't fail the assignment if the StaffApplication update fails —
      // the match-level Assignment is already created and is the source of truth.
      console.warn(
        "assignUmpireToMatch: StaffApplication update failed:",
        saErr.message
      );
    }

    return res.status(201).json({
      message: "Umpire assigned. Awaiting their accept/decline.",
      assignment,
      matchKind,
      staffApplicationUpdated,
    });
  } catch (error) {
    console.error("assignUmpireToMatch error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Phase 4c — returns the caller's authorization summary for a tournament.
// Used by the mobile TournamentLeaderboardDetail to decide which matches are tappable.
exports.getMyAuthorizations = async (req, res) => {
  try {
    const { userId, tournamentId } = req.params;
    if (
      !mongoose.Types.ObjectId.isValid(userId) ||
      !mongoose.Types.ObjectId.isValid(tournamentId)
    ) {
      return res
        .status(400)
        .json({ message: "Invalid userId or tournamentId" });
    }

    // Stage-level grant via accepted StaffApplication
    const StaffApplication = require("../src/modules/social/models/StaffApplication");
    const staffApp = await StaffApplication.findOne({
      userId,
      tournamentId,
      role: "referee",
      status: "accepted",
    })
      .select("stages")
      .lean();

    let stages = [];
    let stagesSource = "none";
    if (staffApp) {
      const hasExplicitStages =
        Array.isArray(staffApp.stages) && staffApp.stages.length > 0;
      if (hasExplicitStages) {
        stages = staffApp.stages.slice();
        stagesSource = "explicit";
      } else {
        // Pre-Phase-4 legacy accepted app → backward-compat "all stages".
        stages = ["group-stage", "knockout"];
        stagesSource = "all-default";
      }
    }

    // Match-level grants via accepted Assignments
    const matchAssignments = await Assignment.find({
      refereeId: userId,
      tournamentId,
      status: "accepted",
      matchId: { $ne: null },
    })
      .select("matchId")
      .lean();

    const matchIds = matchAssignments
      .map((a) => a.matchId?.toString())
      .filter(Boolean);

    // Court-based grants — courts in this tournament whose assigned umpire is
    // this user. The umpire is authorized for every match on these courts.
    const Tournament = require("../src/modules/tournaments/models/Tournament");
    const tourn = await Tournament.findById(tournamentId).select("courts").lean();
    const courts = (tourn?.courts || [])
      .filter((c) => c?.assignedUmpire?.refereeId && String(c.assignedUmpire.refereeId) === String(userId))
      .map((c) => c.name);

    // STRICT court-scoping: a court-assigned umpire is limited to their court(s)
    // — suppress the blanket stage grant so the client won't offer other matches.
    const courtScoped = courts.length > 0;
    const effStages = courtScoped ? [] : stages;
    const effStagesSource = courtScoped ? "court-scoped" : stagesSource;

    return res.status(200).json({
      userId,
      tournamentId,
      hasAnyGrant: effStages.length > 0 || matchIds.length > 0 || courts.length > 0,
      stages: effStages,
      stagesSource: effStagesSource,
      matchIds,
      courts,
    });
  } catch (error) {
    console.error("getMyAuthorizations error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Update referee availability
exports.updateAvailability = async (req, res) => {
  try {
    const { availableDays, availableTimeSlots } = req.body;

    const referee = await Referee.findOne({ userId: req.params.id });

    if (!referee) {
      return res.status(404).json({ message: "Referee profile not found" });
    }

    if (availableDays) {
      referee.availableDays = availableDays;
    }

    if (availableTimeSlots) {
      referee.availableTimeSlots = availableTimeSlots;
    }

    await referee.save();

    res.json(referee);
  } catch (error) {
    console.error("Error updating availability:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all referees (public)
exports.getAllReferees = async (req, res) => {
  try {
    // Find all users with referee role and join with their referee profiles
    const referees = await Referee.find()
      .populate("userId", "name email profileImage")
      .select("-certificates -emergencyContact -emergencyContactName");

    res.json(referees);
  } catch (error) {
    console.error("Error fetching referees:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get referee stats
exports.getRefereeStats = async (req, res) => {
  try {
    const referee = await Referee.findOne({ userId: req.params.id });

    if (!referee) {
      return res.status(404).json({ message: "Referee profile not found" });
    }

    // Count completed matches from TeamKnockout
    const matchesCount = await TeamKnockout.countDocuments({
      $or: [
        { "matches.refereeId": req.params.id, status: "COMPLETED" },
        { refereeId: req.params.id, status: "COMPLETED" },
      ],
    });

    // Add completed assignments count
    const assignmentsCount = await Assignment.countDocuments({
      refereeId: req.params.id,
      status: "completed",
    });

    const totalMatchesCount = matchesCount + assignmentsCount;

    // Count tournaments participated in
    const tournamentIds = await TeamKnockout.distinct("tournamentId", {
      $or: [
        { "matches.refereeId": req.params.id },
        { refereeId: req.params.id },
      ],
    });

    const assignmentTournamentIds = await Assignment.distinct("tournamentId", {
      refereeId: req.params.id,
    });

    // Combine and remove duplicates
    const allTournamentIds = [
      ...new Set([...tournamentIds, ...assignmentTournamentIds]),
    ];
    const tournamentsCount = allTournamentIds.length;

    // Calculate average rating if present
    let averageRating = 0;
    if (referee.ratings && referee.ratings.length > 0) {
      const totalRating = referee.ratings.reduce(
        (sum, rating) => sum + rating.value,
        0
      );
      averageRating = totalRating / referee.ratings.length;
    }

    res.json({
      matchesCount: totalMatchesCount,
      tournamentsCount,
      averageRating: averageRating.toFixed(1),
      experience: referee.experience || 0,
    });
  } catch (error) {
    console.error("Error fetching referee stats:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
