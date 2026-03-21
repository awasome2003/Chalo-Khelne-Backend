const Trainer = require("../Modal/Trainer");
const Session = require("../Modal/Session");
const Request = require("../Modal/Request");
const User = require("../Modal/User");
const notificationController = require("../controllers/notificationController");
const ClubApplication = require("../Modal/TrainerClubApplication");
const Turf = require("../Modal/Turf");

// Get trainer profile
exports.getTrainerProfile = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    let trainer = await Trainer.findOne({ userId: req.params.id });

    if (!trainer) {
      const nameParts = user.name
        ? user.name.split(" ")
        : ["Unnamed", "Trainer"];
      const firstName = nameParts[0];
      const lastName =
        nameParts.length > 1 ? nameParts[nameParts.length - 1] : "Trainer";

      trainer = new Trainer({
        userId: req.params.id,
        firstName: firstName,
        lastName: lastName,
        certificates: [],
        experience: 0,
        sports: [],
        languages: [],
        tags: [],
        verifiedClubs: [],
        sessionTypes: {
          personal: true,
          group: false,
          intermediate: false,
        },
        availability: [],
      });

      await trainer.save();
    }

    // Populate userId with full user details
    await trainer.populate("userId", "name email mobile");

    // GET VERIFIED CLUBS FROM APPROVED APPLICATIONS
    const approvedApplications = await ClubApplication.find({
      trainerId: req.params.id,
      overallStatus: "approved",
    }).populate("turfId", "name clubName address location");

    // Format verified clubs from applications
    const verifiedClubs = approvedApplications.map((app) => ({
      _id: app.turfId._id,
      name: app.turfName || app.turfId.name,
      clubName: app.clubName,
      location: app.turfId.address?.fullAddress || app.turfId.location,
      rating: app.turfId.ratings?.average || 0,
    }));

    // Add verified clubs to trainer object
    const trainerData = {
      ...trainer.toObject(),
      verifiedClubs: verifiedClubs,
    };

    res.json(trainerData);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update trainer profile
exports.updateTrainerProfile = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      dob,
      gender,
      sports,
      experience,
      experienceDescription,
      address,
      emergencyContact,
      emergencyContactName,
      bio,
      languages,
      tags,
    } = req.body;

    let trainer = await Trainer.findOne({ userId: req.params.id });

    if (!trainer) {
      // Create a new trainer profile if it doesn't exist
      trainer = new Trainer({
        userId: req.params.id,
        firstName,
        lastName,
        dob,
        gender,
        sports,
        experience: Number(experience) || 0,
        experienceDescription,
        address,
        emergencyContact,
        emergencyContactName,
        bio,
        languages,
        tags,
        fees: {
          perSession: 0,
          packages: [],
        },
        sessionTypes: {
          personal: true,
          group: false,
          intermediate: false,
        },
        availability: [],
      });
    } else {
      // Update existing trainer profile
      if (firstName) trainer.firstName = firstName;
      if (lastName) trainer.lastName = lastName;
      if (dob) trainer.dob = dob;
      if (gender) trainer.gender = gender;
      if (sports) trainer.sports = sports;
      if (experience !== undefined)
        trainer.experience = Number(experience) || 0;
      if (experienceDescription)
        trainer.experienceDescription = experienceDescription;
      if (address) trainer.address = address;
      if (emergencyContact) trainer.emergencyContact = emergencyContact;
      if (emergencyContactName)
        trainer.emergencyContactName = emergencyContactName;
      if (bio) trainer.bio = bio;
      if (languages) trainer.languages = languages;
      if (tags) trainer.tags = tags;
    }

    await trainer.save();

    // Update the user's name if it has changed
    if (firstName && lastName) {
      await User.updateOne(
        { _id: req.params.id },
        {
          $set: {
            name: `${firstName} ${lastName}`,
            updatedAt: Date.now(),
          },
        }
      );
    }

    res.json(trainer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Handle profile image upload separately
exports.uploadProfileImage = async (req, res) => {
  try {
    const trainer = await Trainer.findOne({ userId: req.params.id });

    if (!trainer) {
      return res.status(404).json({ message: "Trainer profile not found" });
    }

    if (req.file) {
      // Use getRelativePath to convert absolute path to relative URL path
      const relativePath = require("../middleware/uploads").getRelativePath(
        req.file.path
      );
      trainer.profileImage = relativePath;
      await trainer.save();
    }

    res.json({ profileImage: trainer.profileImage });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Add certificate
exports.addCertificate = async (req, res) => {
  try {
    const {
      name,
      issuedBy,
      issueDate,
      expiryDate,
      certificateId,
      certificateUrl,
    } = req.body;

    const trainer = await Trainer.findOne({ userId: req.params.id });

    if (!trainer) {
      return res.status(404).json({ message: "Trainer profile not found" });
    }

    trainer.certificates.push({
      name,
      issuedBy,
      issueDate,
      expiryDate,
      certificateId,
      certificateUrl,
    });

    await trainer.save();

    res.json(trainer.certificates);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Remove certificate
exports.removeCertificate = async (req, res) => {
  try {
    const trainer = await Trainer.findOne({ userId: req.params.id });

    if (!trainer) {
      return res.status(404).json({ message: "Trainer profile not found" });
    }

    const certIndex = trainer.certificates.findIndex(
      (cert) => cert._id.toString() === req.params.certId
    );

    if (certIndex === -1) {
      return res.status(404).json({ message: "Certificate not found" });
    }

    trainer.certificates.splice(certIndex, 1);
    await trainer.save();

    res.json(trainer.certificates);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get trainer sessions
exports.getTrainerSessions = async (req, res) => {
  try {
    // Find the trainer first to ensure the ID is valid
    const trainer = await Trainer.findOne({
      $or: [{ _id: req.params.id }, { userId: req.params.id }],
    });

    if (!trainer) {
      return res.status(404).json({ message: "Trainer not found" });
    }

    // Use the userId to find sessions
    const sessions = await Session.find({
      trainerId: trainer.userId,
    })
      .populate("players", "name email")
      .populate("clubId")
      .sort({ startTime: 1 });

    res.json(sessions);
  } catch (error) {
    console.error("Error in getTrainerSessions:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Get a session by ID
exports.getSessionById = async (req, res) => {
  try {
    const session = await Session.findById(req.params.id)
      .populate("players", "name email image")
      .populate("trainerId", "firstName lastName profileImage")
      .populate("clubId", "name location image");

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    res.json(session);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Create a new session
exports.createSession = async (req, res) => {
  try {
    const {
      title,
      type,
      startTime,
      endTime,
      location,
      trainerId,
      players,
      clubId,
      sportType,
      maxParticipants,
      price,
      notes,
      recurringPattern,
      recurringEndDate,
    } = req.body;

    const session = new Session({
      title,
      type,
      startTime,
      endTime,
      location,
      trainerId,
      players,
      clubId,
      sportType,
      maxParticipants,
      currentParticipants: players ? players.length : 0,
      price,
      notes,
      recurringPattern,
      recurringEndDate,
    });

    await session.save();

    // Notify all players about the new session
    try {
      await notificationController.notifyAllPlayersAboutNewSession(session);
    } catch (notificationError) {
      console.error("Error sending session announcement:", notificationError);
      // Continue with the response even if notifications fail
    }

    // Also keep the existing notification code to notify specifically added players
    try {
      if (players && players.length > 0) {
        await notificationController.notifyNewSession(session);
      }
    } catch (notificationError) {
      console.error("Error sending session notifications:", notificationError);
      // Continue with the response even if notifications fail
    }

    res.json(session);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Update a session
exports.updateSession = async (req, res) => {
  try {
    const {
      title,
      type,
      startTime,
      endTime,
      location,
      players,
      sportType,
      maxParticipants,
      price,
      notes,
      status,
      recurringPattern,
      recurringEndDate,
      trainerId,
    } = req.body;

    const session = await Session.findById(req.params.id);

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    // Track if there are new players to notify
    const oldPlayers = session.players || [];
    const newPlayers = players || [];
    const newPlayerIds = newPlayers.filter(
      (playerId) => !oldPlayers.includes(playerId)
    );

    // Update fields if they are provided
    if (title) session.title = title;
    if (type) session.type = type;
    if (startTime) session.startTime = startTime;
    if (endTime) session.endTime = endTime;
    if (location) session.location = location;
    if (players) {
      session.players = players;
      session.currentParticipants = players.length;
    }
    if (sportType) session.sportType = sportType;
    if (maxParticipants) session.maxParticipants = maxParticipants;
    if (price) session.price = price;
    if (notes) session.notes = notes;
    if (status) session.status = status;
    if (recurringPattern) session.recurringPattern = recurringPattern;
    if (recurringEndDate) session.recurringEndDate = recurringEndDate;

    await session.save();

    // Send notifications to new players
    if (newPlayerIds.length > 0) {
      try {
        // Create a modified session object with only the new players for notification
        const notificationSession = {
          ...session.toObject(),
          players: newPlayerIds,
        };
        await notificationController.notifyNewSession(notificationSession);
      } catch (notificationError) {
        console.error(
          "Error sending session update notifications:",
          notificationError
        );
        // Continue with the response even if notifications fail
      }
    }

    res.json(session);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Delete a session
exports.deleteSession = async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    // Check if the trainer is the one who created the session
    if (session.trainerId.toString() !== req.user.id) {
      return res.status(401).json({ message: "Not authorized" });
    }

    // Use deleteOne instead of remove (which is deprecated)
    await Session.deleteOne({ _id: req.params.id });

    res.json({ message: "Session removed" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get training requests
exports.getTrainingRequests = async (req, res) => {
  try {
    const requests = await Request.find({
      trainerId: req.params.id,
      status: "pending",
    })
      .populate("playerId", "name email")
      .populate("clubId")
      .sort({ createdAt: -1 });

    res.json(requests);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Accept a training request
exports.acceptRequest = async (req, res) => {
  try {
    const request = await Request.findById(req.params.id).populate("sessionId");

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    request.status = "accepted";
    await request.save();

    // Send notification to the player about acceptance
    try {
      await notificationController.notifySessionResponse(request, "accepted");
    } catch (notificationError) {
      console.error(
        "Error sending acceptance notification:",
        notificationError
      );
      // Continue with the response even if notification fails
    }

    // Handle different request types
    if (request.requestType === "join_session" && request.sessionId) {
      // Add player to existing session
      const session = request.sessionId;

      // Add player to the session if not already added
      if (!session.players.includes(request.playerId)) {
        session.players.push(request.playerId);
        session.currentParticipants = session.players.length;
        await session.save();
      }

      res.json({ request, session });
    } else {
      // Create a new session from the request
      const session = new Session({
        title: request.sessionType + " Training",
        type: request.sessionType || "personal",
        startTime: new Date(
          request.requestedDate + "T" + request.requestedTime
        ),
        endTime: new Date(
          new Date(
            request.requestedDate + "T" + request.requestedTime
          ).getTime() +
            60 * 60 * 1000
        ), // Add 1 hour
        location: request.location || "Default Location",
        trainerId: request.trainerId,
        players: request.playerId ? [request.playerId] : [],
        clubId: request.clubId || null,
        sportType: request.sportType || "General",
        maxParticipants: request.sessionType === "group" ? 10 : 1,
        currentParticipants: request.playerId ? 1 : 0,
        price: request.price || 0,
        notes: request.notes,
        status: "scheduled",
      });

      await session.save();

      // No need to send additional session notification since we already sent an acceptance
      // notification which includes the session details

      res.json({ request, session });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Reject a training request
exports.rejectRequest = async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    request.status = "rejected";
    await request.save();

    // Send notification to the player about the rejection
    try {
      await notificationController.notifySessionResponse(request, "rejected");
    } catch (notificationError) {
      console.error("Error sending rejection notification:", notificationError);
      // Continue with the response even if notification fails
    }

    res.json(request);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get all trainers (public)
exports.getAllTrainers = async (req, res) => {
  try {
    // Query parameters for filtering
    const { sport, rating, price, verified } = req.query;

    // Build the query object
    let query = {};

    if (sport) {
      query.sports = { $in: [sport] };
    }

    if (rating) {
      query.rating = { $gte: parseFloat(rating) };
    }

    if (price) {
      query["fees.perSession"] = { $lte: parseFloat(price) };
    }

    if (verified === "true") {
      query.verifiedClubs = { $exists: true, $ne: [] };
    }

    // Find all trainers with the given filters
    const trainers = await Trainer.find(query)
      .populate("userId", "name email")
      .populate("verifiedClubs", "name location")
      .select("-certificates -emergencyContact -emergencyContactName");

    res.json(trainers);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get trainer by ID (public)
exports.getTrainerById = async (req, res) => {
  try {
    const trainer = await Trainer.findById(req.params.id)
      .populate("userId", "name email")
      .select("-emergencyContact -emergencyContactName");

    if (!trainer) {
      return res.status(404).json({ message: "Trainer not found" });
    }

    // GET VERIFIED CLUBS FROM APPROVED APPLICATIONS
    const approvedApplications = await ClubApplication.find({
      trainerId: trainer.userId,
      overallStatus: "approved",
    }).populate("turfId", "name clubName address location ratings");

    // Format verified clubs from applications
    const verifiedClubs = approvedApplications.map((app) => ({
      _id: app.turfId._id,
      name: app.turfName || app.turfId.name,
      clubName: app.clubName,
      location: app.turfId.address?.fullAddress || app.turfId.location,
      rating: app.turfId.ratings?.average || 0,
    }));

    // Get the trainer's sessions count
    const sessionCount = await Session.countDocuments({
      trainerId: trainer._id,
      status: "completed",
    });

    // Get average rating from sessions
    const sessionsWithFeedback = await Session.find({
      trainerId: trainer._id,
      "feedback.0": { $exists: true },
    });

    // Create response object with additional data
    const trainerData = {
      ...trainer.toObject(),
      sessionCount,
      sessionsWithFeedback: sessionsWithFeedback.length,
      verifiedClubs: verifiedClubs,
    };

    res.json(trainerData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Update trainer availability
exports.updateAvailability = async (req, res) => {
  try {
    const { availability } = req.body;

    if (!availability || !Array.isArray(availability)) {
      return res.status(400).json({ message: "Invalid availability data" });
    }

    const trainer = await Trainer.findOne({ userId: req.params.id });

    if (!trainer) {
      return res.status(404).json({ message: "Trainer profile not found" });
    }

    trainer.availability = availability;
    await trainer.save();

    res.json(trainer.availability);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Update trainer fees
exports.updateFees = async (req, res) => {
  try {
    const { perSession, packages } = req.body;

    const trainer = await Trainer.findOne({ userId: req.params.id });

    if (!trainer) {
      return res.status(404).json({ message: "Trainer profile not found" });
    }

    if (perSession !== undefined) {
      trainer.fees.perSession = perSession;
    }

    if (packages && Array.isArray(packages)) {
      trainer.fees.packages = packages;
    }

    await trainer.save();

    res.json(trainer.fees);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Update session types
exports.updateSessionTypes = async (req, res) => {
  try {
    const { personal, group, intermediate } = req.body;

    const trainer = await Trainer.findOne({ userId: req.params.id });

    if (!trainer) {
      return res.status(404).json({ message: "Trainer profile not found" });
    }

    if (personal !== undefined) trainer.sessionTypes.personal = personal;
    if (group !== undefined) trainer.sessionTypes.group = group;
    if (intermediate !== undefined)
      trainer.sessionTypes.intermediate = intermediate;

    await trainer.save();

    res.json(trainer.sessionTypes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Add feedback to a session
exports.addSessionFeedback = async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const playerId = req.user.id;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: "Invalid rating value (1-5)" });
    }

    const session = await Session.findById(req.params.sessionId);

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    // Check if player is part of this session
    if (!session.players.includes(playerId)) {
      return res.status(403).json({
        message: "Not authorized to provide feedback for this session",
      });
    }

    // Check if player already gave feedback
    const existingFeedbackIndex = session.feedback.findIndex(
      (f) => f.playerId.toString() === playerId
    );

    if (existingFeedbackIndex !== -1) {
      // Update existing feedback
      session.feedback[existingFeedbackIndex].rating = rating;
      session.feedback[existingFeedbackIndex].comment = comment;
    } else {
      // Add new feedback
      session.feedback.push({
        playerId,
        rating,
        comment,
        createdAt: new Date(),
      });
    }

    await session.save();

    res.json(session.feedback);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get verified clubs for trainer
exports.getVerifiedClubs = async (req, res) => {
  try {
    // First find the trainer by userId instead of direct ID
    const trainer = await Trainer.findOne({ userId: req.params.id }).populate(
      "verifiedClubs",
      "name location rating reviewCount image website"
    );

    if (!trainer) {
      return res.status(404).json({ message: "Trainer not found" });
    }

    res.json(trainer.verifiedClubs || []);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Player Side Sessions Controller Function
// Request a new session
exports.requestSession = async (req, res) => {
  try {
    const {
      type,
      playerId,
      playerName,
      trainerId,
      requestedDate,
      requestedTime,
      sessionType,
      location,
      notes,
      sportType,
      clubId,
      clubName,
    } = req.body;

    // Find trainer to get their pricing if available
    let price = 0;
    if (trainerId) {
      const trainer = await Trainer.findOne({ userId: trainerId });
      if (trainer && trainer.fees && trainer.fees.perSession) {
        price = trainer.fees.perSession;

        // Adjust price based on session type
        if (sessionType === "group" && price > 0) {
          // Group sessions might be cheaper per person
          price = Math.round(price * 0.7);
        } else if (sessionType === "intermediate" && price > 0) {
          // Intermediate sessions might be more expensive
          price = Math.round(price * 1.2);
        }
      }
    }

    const request = new Request({
      type: type || "player",
      playerId,
      playerName,
      trainerId,
      requestedDate,
      requestedTime,
      sessionType: sessionType || "personal",
      location,
      notes,
      price: price, // Use calculated price from trainer's rates
      sportType: sportType || "General",
      clubId,
      clubName,
      requestType: "new_session",
      status: "pending",
    });

    await request.save();

    // Send notification to the trainer about new session request
    try {
      await notificationController.notifySessionRequest(request);
    } catch (notificationError) {
      console.error(
        "Error sending session request notification:",
        notificationError
      );
      // Continue with the response even if notification fails
    }

    res.status(201).json({
      message: "Session request submitted successfully",
      requestId: request._id,
      status: request.status,
    });
  } catch (error) {
    console.error("Error creating session request:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Request to join an existing session
exports.requestJoinSession = async (req, res) => {
  try {
    const { sessionId, playerId, notes } = req.body;

    // Get the session details
    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    // Validations
    if (session.currentParticipants >= session.maxParticipants) {
      return res.status(400).json({ message: "Session is already full" });
    }

    if (session.players.includes(playerId)) {
      return res
        .status(400)
        .json({ message: "Already enrolled in this session" });
    }

    // Get player details
    const player = await User.findById(playerId);
    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    // Create join request with session's price
    const request = new Request({
      type: "player",
      playerId: playerId,
      playerName: player.name,
      trainerId: session.trainerId,
      sessionId: session._id,
      requestType: "join_session",
      requestedDate: new Date(session.startTime).toISOString().split("T")[0],
      requestedTime: new Date(session.startTime).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      sessionType: session.type,
      location: session.location,
      price: session.price, // Use the session's defined price
      sportType: session.sportType,
      notes: notes || "Request to join session",
      status: "pending",
    });

    await request.save();

    // Send notification to the trainer about session join request
    try {
      await notificationController.notifySessionRequest(request);
    } catch (notificationError) {
      console.error(
        "Error sending join session request notification:",
        notificationError
      );
      // Continue with the response even if notification fails
    }

    res.status(201).json({
      message: "Join request submitted successfully",
      requestId: request._id,
      status: request.status,
    });
  } catch (error) {
    console.error("Error creating join request:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Cancel a training request (for players)
exports.cancelRequest = async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    // Make sure the request is still in a cancelable state
    if (request.status !== "pending") {
      return res.status(400).json({
        message: "Cannot cancel a request that has already been processed",
      });
    }

    // Update request status to cancelled
    request.status = "cancelled";
    await request.save();

    // Send notification to the trainer about the cancellation
    try {
      await notificationController.notifyCancellation(request);
    } catch (notificationError) {
      console.error(
        "Error sending cancellation notification:",
        notificationError
      );
      // Continue with the response even if notification fails
    }

    res.json({ message: "Request cancelled successfully", request });
  } catch (error) {
    console.error("Error cancelling request:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get my training sessions and requests
exports.getMyTrainingSessions = async (req, res) => {
  try {
    const userId = req.params.userId;

    // Get all requests by this user (this part looks correct)
    const requests = await Request.find({
      playerId: userId,
    })
      .populate("trainerId", "name email")
      .populate("sessionId")
      .sort({ updatedAt: -1 });

    // For each request, get the Trainer document associated with the User
    const populatedRequests = await Promise.all(
      requests.map(async (request) => {
        let requestObj = request.toObject();

        if (requestObj.trainerId) {
          // Find the trainer profile for this user
          const trainer = await Trainer.findOne({
            userId: requestObj.trainerId._id,
          });

          if (trainer) {
            // Add trainer details to the request
            requestObj.trainerProfile = {
              firstName: trainer.firstName,
              lastName: trainer.lastName,
              profileImage: trainer.profileImage,
            };
          }
        }

        return requestObj;
      })
    );

    // Get all sessions this user is enrolled in
    const sessions = await Session.find({
      players: userId,
      status: { $in: ["scheduled", "in-progress"] },
    })
      // Don't populate here since the IDs are mismatched
      .sort({ startTime: 1 });

    // Process each session manually
    const populatedSessions = await Promise.all(
      sessions.map(async (session) => {
        let sessionObj = session.toObject();

        // First try to find a trainer directly by the ID in the trainerId field
        let trainer = await Trainer.findById(sessionObj.trainerId);

        // If not found and trainerId exists, try to find by userId
        if (!trainer && sessionObj.trainerId) {
          trainer = await Trainer.findOne({ userId: sessionObj.trainerId });
        }

        // If trainer found, add profile details
        if (trainer) {
          sessionObj.trainerProfile = {
            firstName: trainer.firstName,
            lastName: trainer.lastName,
            profileImage: trainer.profileImage,
          };
        } else if (sessionObj.trainerId) {
          // If no trainer found but have trainerId, try to get user info
          const user = await User.findById(sessionObj.trainerId);
          if (user) {
            const nameParts = user.name?.split(" ") || ["Unknown"];
            sessionObj.trainerProfile = {
              firstName: nameParts[0],
              lastName: nameParts.slice(1).join(" ") || "",
              profileImage: null,
            };
          }
        }

        return sessionObj;
      })
    );

    // Combine both for "My Training" section
    const myTraining = {
      requests: populatedRequests,
      sessions: populatedSessions,
    };

    res.json(myTraining);
  } catch (error) {
    console.error("Error fetching my training data:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get pending session requests for trainer dashboard
exports.getTrainerSessionRequests = async (req, res) => {
  try {
    const trainerId = req.params.id;
    const { status } = req.query; // Add support for status filtering

    // Build the query
    const query = { trainerId: trainerId };

    // Add status filter if provided, otherwise default to "pending"
    if (status) {
      query.status = status;
    } else {
      query.status = "pending";
    }

    // Get all requests for this trainer based on query
    const requests = await Request.find(query)
      .populate("playerId", "name email image")
      .populate("sessionId")
      .sort({ createdAt: -1 });
    res.json(requests);
  } catch (error) {
    console.error("Error fetching trainer session requests:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get request status
exports.getRequestStatus = async (req, res) => {
  try {
    const requestId = req.params.requestId;

    const request = await Request.findById(requestId);

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    // Get additional data if the request is accepted
    let sessionData = null;
    if (request.status === "accepted" && request.sessionId) {
      sessionData = await Session.findById(request.sessionId).populate(
        "trainerId",
        "firstName lastName profileImage"
      );
    }

    res.json({
      status: request.status,
      requestType: request.requestType,
      requestedDate: request.requestedDate,
      requestedTime: request.requestedTime,
      sessionType: request.sessionType,
      sessionData: sessionData,
    });
  } catch (error) {
    console.error("Error fetching request status:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Add or update certificate
exports.addCertificate = async (req, res) => {
  try {
    // Get data from request
    const {
      name,
      issuedBy,
      issueDate,
      expiryDate,
      certificateId,
      existingCertificateId,
    } = req.body;

    // Validate required fields
    if (!name || !issuedBy || !issueDate) {
      if (req.file)
        await require("../middleware/uploads").cleanupFile(req.file.path);
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Find the trainer
    const trainer = await require("../Modal/Trainer").findOne({
      userId: req.params.id,
    });
    if (!trainer) {
      if (req.file)
        await require("../middleware/uploads").cleanupFile(req.file.path);
      return res.status(404).json({ error: "Trainer profile not found" });
    }

    // Import path conversion function
    const { getRelativePath } = require("../middleware/uploads");

    // Handle existing certificate update
    if (existingCertificateId) {
      const certIndex = trainer.certificates.findIndex(
        (cert) => cert._id.toString() === existingCertificateId
      );

      if (certIndex === -1) {
        if (req.file)
          await require("../middleware/uploads").cleanupFile(req.file.path);
        return res.status(404).json({ error: "Certificate not found" });
      }

      // Update fields
      trainer.certificates[certIndex].name = name;
      trainer.certificates[certIndex].issuedBy = issuedBy;
      trainer.certificates[certIndex].issueDate = new Date(issueDate);
      if (expiryDate)
        trainer.certificates[certIndex].expiryDate = new Date(expiryDate);
      if (certificateId)
        trainer.certificates[certIndex].certificateId = certificateId;

      // Update file with relative path if provided
      if (req.file) {
        trainer.certificates[certIndex].certificateUrl = getRelativePath(
          req.file.path
        );
      }

      await trainer.save();
      return res.status(200).json({
        success: true,
        message: "Certificate updated successfully",
        certificates: trainer.certificates,
      });
    }

    // Add new certificate
    const newCertificate = {
      name,
      issuedBy,
      issueDate: new Date(issueDate),
    };

    if (expiryDate) newCertificate.expiryDate = new Date(expiryDate);
    if (certificateId) newCertificate.certificateId = certificateId;

    // Add file with relative path if uploaded
    if (req.file) {
      newCertificate.certificateUrl = getRelativePath(req.file.path);
    }

    trainer.certificates.push(newCertificate);
    await trainer.save();

    return res.status(201).json({
      success: true,
      message: "Certificate added successfully",
      certificates: trainer.certificates,
    });
  } catch (error) {
    console.error("Error handling certificate:", error);
    if (req.file)
      await require("../middleware/uploads").cleanupFile(req.file.path);
    res.status(500).json({ error: "Server error" });
  }
};

// Get available session types
exports.getSessionTypes = async (req, res) => {
  try {
    const trainerId = req.params.id;

    // First check if a specific trainer ID is provided
    if (trainerId) {
      // Find the trainer to get their available session types
      const trainer = await Trainer.findOne({
        $or: [{ _id: trainerId }, { userId: trainerId }],
      });

      if (!trainer) {
        return res.status(404).json({ message: "Trainer not found" });
      }

      // Create session types array based on trainer's configuration
      const sessionTypes = [];

      if (trainer.sessionTypes.personal) {
        const basePrice = trainer.fees?.perSession || 1000;
        sessionTypes.push({
          id: "personal",
          name: "Personal Session",
          icon: "person-outline",
          description: "One-on-one training customized to your skill level",
          available: true,
          pricing: basePrice,
          details: {
            duration: "1-2 hours",
            participants: "Individual (1 person)",
            pricing: `₹${basePrice} - ₹${basePrice + 1000} per hour`,
            expectations: [
              "Personalized guidance from a professional coach",
              "Skill assessment and improvement plan",
              "Technique refinement and practice drills",
              "Feedback and follow-up recommendations",
            ],
          },
        });
      }

      if (trainer.sessionTypes.group) {
        const basePrice = trainer.fees?.perSession
          ? Math.round(trainer.fees.perSession * 0.7)
          : 500;
        sessionTypes.push({
          id: "group",
          name: "Group Session",
          icon: "people-outline",
          description: "Train with others at similar skill levels",
          available: true,
          pricing: basePrice,
          details: {
            duration: "1-2 hours",
            participants: "Small group (3-6 people)",
            pricing: `₹${basePrice} - ₹${basePrice + 300} per person`,
            expectations: [
              "Collaborative learning environment",
              "Team-based drills and exercises",
              "Skill development through group activities",
              "Feedback in a group setting",
            ],
          },
        });
      }

      if (trainer.sessionTypes.intermediate) {
        const basePrice = trainer.fees?.perSession
          ? Math.round(trainer.fees.perSession * 1.2)
          : 800;
        sessionTypes.push({
          id: "intermediate",
          name: "Intermediate Session",
          icon: "school-outline",
          description: "Focus on specific techniques or strategies",
          available: true,
          pricing: basePrice,
          details: {
            duration: "1-2 hours",
            participants: "Large group (10+ people)",
            pricing: `₹${basePrice} - ₹${basePrice + 700} per person`,
            expectations: [
              "Advanced technique development",
              "Strategy and tactic-focused training",
              "Specialized drills for specific skills",
              "Performance analysis and improvement plans",
            ],
          },
        });
      }

      return res.json(sessionTypes);
    }

    // If no specific trainer ID, return all possible session types with default pricing
    const sessionTypes = [
      {
        id: "personal",
        name: "Personal Session",
        icon: "person-outline",
        description: "One-on-one training customized to your skill level",
        available: true,
        pricing: 1000,
        details: {
          duration: "1-2 hours",
          participants: "Individual (1 person)",
          pricing: "₹1,000 - ₹2,000 per hour",
          expectations: [
            "Personalized guidance from a professional coach",
            "Skill assessment and improvement plan",
            "Technique refinement and practice drills",
            "Feedback and follow-up recommendations",
          ],
        },
      },
      {
        id: "group",
        name: "Group Session",
        icon: "people-outline",
        description: "Train with others at similar skill levels",
        available: true,
        pricing: 500,
        details: {
          duration: "1-2 hours",
          participants: "Small group (3-6 people)",
          pricing: "₹500 - ₹800 per person",
          expectations: [
            "Collaborative learning environment",
            "Team-based drills and exercises",
            "Skill development through group activities",
            "Feedback in a group setting",
          ],
        },
      },
      {
        id: "intermediate",
        name: "Intermediate Session",
        icon: "school-outline",
        description: "Focus on specific techniques or strategies",
        available: true,
        pricing: 800,
        details: {
          duration: "1-2 hours ",
          participants: "Large group (10+ people)",
          pricing: "₹800 - ₹1,500 per person",
          expectations: [
            "Advanced technique development",
            "Strategy and tactic-focused training",
            "Specialized drills for specific skills",
            "Performance analysis and improvement plans",
          ],
        },
      },
    ];

    res.json(sessionTypes);
  } catch (error) {
    console.error("Error fetching session types:", error);
    res.status(500).json({
      message: "Error fetching session types",
      error: error.message,
    });
  }
};

// Apply to join a club/turf
exports.applyToClub = async (req, res) => {
  try {
    const {
      trainerId,
      clubId,
      clubName,
      turfId,
      turfName,
      applicationMessage,
      selectedCertificates,
    } = req.body;

    const actualClubId = typeof clubId === "object" ? clubId._id : clubId;

    // Validate required fields
    if (!trainerId || !actualClubId || !turfId) {
      return res.status(400).json({
        message: "Trainer ID, Club ID, and Turf ID are required",
      });
    }

    // Check if trainer already applied to this turf
    const existingApplication = await ClubApplication.findOne({
      trainerId,
      turfId,
    });

    if (existingApplication) {
      return res.status(400).json({
        message: "You have already applied to this turf",
        status: existingApplication.overallStatus,
      });
    }

    // Get turf details and validate
    const turf = await Turf.findById(turfId);
    if (!turf) {
      return res.status(404).json({ message: "Turf not found" });
    }

    if (!turf.assignedManagers || turf.assignedManagers.length === 0) {
      return res.status(400).json({
        message: "No manager assigned to this turf",
      });
    }

    // Get all assigned managers for this turf
    const { Manager } = require("../Modal/ClubManager");
    const assignedManagerIds = turf.assignedManagers;
    const managers = await Manager.find({
      _id: { $in: assignedManagerIds },
      isActive: true,
    });

    if (!managers || managers.length === 0) {
      return res.status(404).json({
        message: "No active managers found for this turf",
      });
    }

    // Get trainer details
    const trainer = await Trainer.findOne({ userId: trainerId });
    if (!trainer) {
      return res.status(404).json({ message: "Trainer profile not found" });
    }

    // Prepare certificates for application
    let applicationCertificates = [];
    if (selectedCertificates && selectedCertificates.length > 0) {
      applicationCertificates = trainer.certificates
        .filter((cert) => selectedCertificates.includes(cert._id.toString()))
        .map((cert) => ({
          name: cert.name,
          issuedBy: cert.issuedBy,
          issueDate: cert.issueDate,
          expiryDate: cert.expiryDate,
          certificateId: cert.certificateId,
          certificateUrl: cert.certificateUrl,
          _id: cert._id,
        }));
    }

    // Create managers array for the application
    const managersArray = managers.map((manager) => ({
      managerId: manager._id,
      status: "pending",
    }));

    // Create single application with multiple managers
    const application = new ClubApplication({
      trainerId,
      clubId: actualClubId,
      clubName,
      turfId,
      turfName,
      assignedManagers: managersArray,
      overallStatus: "pending",
      applicationMessage,
      trainerExperience: trainer.experienceDescription,
      trainerSports: trainer.sports,
      certificates: applicationCertificates,
    });

    await application.save();

    // Send notifications to all managers
    for (const manager of managers) {
      try {
        // Create a notification object with manager-specific data
        const notificationData = {
          _id: application._id,
          trainerId: application.trainerId,
          clubName: application.clubName,
          turfName: application.turfName,
          managerId: manager._id,
          applicationMessage: application.applicationMessage,
          certificates: application.certificates,
        };

        await notificationController.notifyClubApplication(notificationData);
      } catch (notificationError) {
        console.error(
          `Error sending application notification to manager ${manager._id}:`,
          notificationError
        );
      }
    }

    console.log(`Created 1 application for ${managers.length} managers`);

    res.status(201).json({
      message: "Application submitted successfully",
      applicationId: application._id,
      managerCount: managers.length,
      status: "pending",
      certificatesIncluded: applicationCertificates.length,
    });
  } catch (error) {
    console.error("Error submitting club application:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Get trainer's club applications
exports.getMyClubApplications = async (req, res) => {
  try {
    const { trainerId } = req.params;

    const applications = await ClubApplication.find({ trainerId })
      .populate("clubId", "name clubName")
      .populate("turfId", "name address")
      .populate("assignedManagers.managerId", "name email isActive") // ClubManager details
      .sort({ appliedAt: -1 });

    res.json(applications);
  } catch (error) {
    console.error("Error fetching club applications:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Check application status for a specific turf
exports.checkApplicationStatus = async (req, res) => {
  try {
    const { trainerId, turfId } = req.params;

    const application = await ClubApplication.findOne({
      trainerId,
      turfId,
    })
      .populate("managerId", "name email")
      .populate("turfId", "name clubName");

    if (!application) {
      return res.json({
        canApply: true,
        message: "No application found for this turf",
      });
    }

    res.json({
      canApply: false,
      application: {
        status: application.status,
        appliedAt: application.appliedAt,
        reviewedAt: application.reviewedAt,
        rejectionReason: application.rejectionReason,
        manager: application.managerId,
        turf: application.turfId,
      },
    });
  } catch (error) {
    console.error("Error checking application status:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Cancel pending application
exports.cancelApplication = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { trainerId } = req.body;

    const application = await ClubApplication.findOne({
      _id: applicationId,
      trainerId,
      status: "pending",
    });

    if (!application) {
      return res.status(404).json({
        message: "Pending application not found",
      });
    }

    await ClubApplication.findByIdAndDelete(applicationId);

    res.json({ message: "Application cancelled successfully" });
  } catch (error) {
    console.error("Error cancelling application:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get certified trainers for a specific turf
exports.getCertifiedTrainers = async (req, res) => {
  try {
    const { turfId } = req.params;

    if (!turfId) {
      return res.status(400).json({ message: "Turf ID is required" });
    }

    // Find approved applications for this turf
    const approvedApplications = await ClubApplication.find({
      turfId: turfId,
      overallStatus: "approved",
    }).distinct("trainerId");

    if (approvedApplications.length === 0) {
      return res.json([]);
    }

    // Get trainer details for approved trainers
    const trainers = await Trainer.find({
      userId: { $in: approvedApplications },
    })
      .populate("userId", "name email")
      .select(
        "firstName lastName profileImage sports experience experienceDescription"
      )
      .limit(10);

    // Format response with verified clubs count
    const formattedTrainers = await Promise.all(
      trainers.map(async (trainer) => {
        // Count approved applications for this trainer across all clubs
        const verifiedClubsCount = await ClubApplication.distinct("clubId", {
          trainerId: trainer.userId,
          overallStatus: "approved",
        });

        return {
          firstName: trainer.firstName,
          lastName: trainer.lastName,
          profileImage: trainer.profileImage,
          sports: trainer.sports,
          experience: trainer.experience,
          experienceDescription: trainer.experienceDescription,
          name: trainer.userId?.name,
          rating: trainer.rating || 0,
          reviewCount: trainer.reviewCount || 0,
          verifiedClubsCount: verifiedClubsCount.length,
          _id: trainer._id,
          userId: trainer.userId?._id,
        };
      })
    );

    console.log(
      `Found ${formattedTrainers.length} certified trainers for turf ${turfId}`
    );
    res.json(formattedTrainers);
  } catch (error) {
    console.error("Error fetching certified trainers:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};
