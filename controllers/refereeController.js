const Referee = require("../Modal/Referee");
const User = require("../Modal/User");
const TeamKnockout = require("../Modal/TeamKnockoutMatches"); // Updated to use TeamKnockout instead of Match
const Assignment = require("../Modal/Assignment");
const { cleanupFile } = require("../middleware/uploads");
const path = require("path");

// Get referee profile
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

    const referee = await Referee.findOne({ userId: req.params.id });

    if (!referee) {
      return res.status(404).json({ message: "Referee profile not found" });
    }

    referee.certificates.push({
      name,
      issuedBy,
      issueDate,
      expiryDate,
      certificateId,
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
      await match.save();

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
      await match.save();

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
