const Notification = require("../Modal/Notification");
const User = require("../Modal/User");
const Trainer = require("../Modal/Trainer");
const { Expo } = require("expo-server-sdk");
const expo = new Expo();
const mongoose = require("mongoose");

// Create notification for a single user
exports.createNotification = async (userId, data) => {
  try {
    const newNotification = new Notification({
      userId,
      title: data.title,
      message: data.message,
      type: data.type,
      relatedId: data.relatedId,
      status: data.status, // For storing accept/reject status
      read: false,
      createdAt: new Date(),
    });

    await newNotification.save();
    return newNotification;
  } catch (error) {
    console.error("Error creating notification:", error);
    throw error;
  }
};

// Update ExpoPushToken function to only update for new users
exports.updateExpoPushToken = async (req, res) => {
  try {
    const { userId } = req.params;
    const { expoPushToken } = req.body;

    // Check if user exists
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Update the token if it's different from what we have
    if (user.expoPushToken !== expoPushToken) {
      await User.findByIdAndUpdate(userId, { expoPushToken }, { new: true });

      return res.status(200).json({
        success: true,
        message: "Expo push token updated successfully",
      });
    } else {
      // Token is already the same
      return res.status(200).json({
        success: true,
        message: "Token already up to date",
      });
    }
  } catch (error) {
    console.error("Error updating expo push token:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update expo push token",
    });
  }
};

// Create notification for multiple users
exports.createBulkNotifications = async (userIds, data) => {
  try {
    const notifications = userIds.map((userId) => ({
      userId,
      title: data.title,
      message: data.message,
      type: data.type,
      relatedId: data.relatedId,
      status: data.status,
      read: false,
      createdAt: new Date(),
    }));

    const result = await Notification.insertMany(notifications);
    return result;
  } catch (error) {
    console.error("Error creating bulk notifications:", error);
    throw error;
  }
};

// Notify all players about a new tournament
exports.notifyNewTournament = async (tournament) => {
  try {
    // Get all users with player role
    const players = await User.find({ role: "Player" });

    if (!players || players.length === 0) {
      return [];
    }

    const playerIds = players.map((player) => player._id);

    // Create notification data
    const notificationData = {
      title: "New Tournament Available",
      message: `New ${tournament.type} tournament "${tournament.title}" is now available in ${tournament.eventLocation}`,
      type: "event",
      relatedId: tournament._id,
    };

    // Create notifications in database
    const notifications = await this.createBulkNotifications(
      playerIds,
      notificationData
    );

    // Send push notifications to devices
    await this.sendPushNotifications(playerIds, notificationData);

    return notifications;
  } catch (error) {
    console.error("Error notifying about new tournament:", error);
    throw error;
  }
};

// NEW: Notify players about a new session
exports.notifyNewSession = async (session) => {
  try {
    // Get the player IDs from the session
    const playerIds = session.players || [];

    if (playerIds.length === 0) {
      return [];
    }

    // Get trainer details for a more personalized notification
    let trainerName = "Your trainer";
    try {
      const trainer = await Trainer.findOne({ userId: session.trainerId });
      if (trainer) {
        trainerName = `${trainer.firstName} ${trainer.lastName}`;
      }
    } catch (err) {
      console.error("Error getting trainer name:", err);
    }

    // Format dates for readability
    const startDate = new Date(session.startTime).toLocaleDateString();
    const startTime = new Date(session.startTime).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    // Create notification data
    const notificationData = {
      title: `New Training Session`,
      message: `${trainerName} has scheduled a new ${session.type} session "${session.title}" on ${startDate} at ${startTime}`,
      type: "session",
      relatedId: session._id,
    };



    // Create notifications in database
    const notifications = await this.createBulkNotifications(
      playerIds,
      notificationData
    );

    // Send push notifications to devices
    await this.sendPushNotifications(playerIds, notificationData);

    return notifications;
  } catch (error) {
    console.error("Error notifying about new session:", error);
    throw error;
  }
};

// Notify all players about a new session created by a trainer
exports.notifyAllPlayersAboutNewSession = async (session) => {
  try {
    // Get all users with player role
    const players = await User.find({ role: "Player" });

    if (!players || players.length === 0) {
      return [];
    }

    const playerIds = players.map((player) => player._id);

    // Get trainer details
    let trainerName = "A trainer";
    try {
      const trainer = await Trainer.findOne({ userId: session.trainerId });
      if (trainer) {
        trainerName = `${trainer.firstName} ${trainer.lastName}`;
      }
    } catch (err) {
      console.error("Error getting trainer name:", err);
    }

    // Format dates for readability
    const startDate = new Date(session.startTime).toLocaleDateString();
    const startTime = new Date(session.startTime).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    // Create notification data
    const notificationData = {
      title: `New ${session.type} Session Available`,
      message: `${trainerName} has created a new ${session.type} session "${session.title}" on ${startDate} at ${startTime}`,
      type: "session_announcement",
      relatedId: session._id,
    };



    // Create notifications in database
    const notifications = await this.createBulkNotifications(
      playerIds,
      notificationData
    );

    // Send push notifications to devices
    await this.sendPushNotifications(playerIds, notificationData);

    return notifications;
  } catch (error) {
    console.error("Error notifying about new session:", error);
    throw error;
  }
};

// NEW: Notify player about session request response
exports.notifySessionResponse = async (request, status) => {
  try {
    // If this is a player cancellation, notify the trainer
    if (status === "cancelled_by_player") {
      const trainerId = request.trainerId;
      if (!trainerId) {
        console.log("No trainer ID found in request, skipping notification");
        return null;
      }

      // Get player name
      let playerName = request.playerName || "A player";
      if (!request.playerName && request.playerId) {
        try {
          const player = await User.findById(request.playerId);
          if (player) {
            playerName = player.name;
          }
        } catch (err) {
          console.error("Error getting player name:", err);
        }
      }

      // Create cancellation message
      let message;
      if (request.requestType === "join_session") {
        message = `${playerName} has cancelled their request to join your ${request.sessionType} session on ${request.requestedDate} at ${request.requestedTime}`;
      } else {
        message = `${playerName} has cancelled their request for a ${request.sessionType} session on ${request.requestedDate} at ${request.requestedTime}`;
      }

      const notificationData = {
        title: "Training Request Cancelled",
        message: message,
        type: "request",
        relatedId: request._id,
        status: "rejected", // Use a valid status from the Request schema
      };

      // Create notification in database
      const notification = await this.createNotification(
        trainerId,
        notificationData
      );

      // Send push notification to device
      await this.sendPushNotifications([trainerId], notificationData);

      return notification;
    } else {
      // Original function code for accepted/rejected stays the same
      const playerId = request.playerId;
      if (!playerId) {
        console.log("No player ID found in request, skipping notification");
        return null;
      }

      // Get trainer name if available
      let trainerName = "Your trainer";
      try {
        const trainer = await Trainer.findOne({ userId: request.trainerId });
        if (trainer) {
          trainerName = `${trainer.firstName} ${trainer.lastName}`;
        }
      } catch (err) {
        console.error("Error getting trainer name:", err);
      }

      // Create appropriate message based on status
      let message;
      if (status === "accepted") {
        message = `${trainerName} has accepted your request for a ${request.sessionType} session on ${request.requestedDate} at ${request.requestedTime}`;
      } else {
        message = `${trainerName} has declined your request for a ${request.sessionType} session on ${request.requestedDate} at ${request.requestedTime}`;
      }

      const notificationData = {
        title: `Session Request ${status === "accepted" ? "Accepted" : "Declined"
          }`,
        message: message,
        type: "response",
        relatedId: request._id,
        status: status, // Include status for navigation purposes
      };

      // Create notification in database
      const notification = await this.createNotification(
        playerId,
        notificationData
      );

      // Send push notification to device
      await this.sendPushNotifications([playerId], notificationData);

      return notification;
    }
  } catch (error) {
    console.error(`Error notifying about ${status} response:`, error);
    throw error;
  }
};

// NEW: Notify trainer about new session request
exports.notifySessionRequest = async (request) => {
  try {
    const trainerId = request.trainerId;
    if (!trainerId) {
      console.log("No trainer ID found in request, skipping notification");
      return null;
    }

    // Get player name
    let playerName = request.playerName || "A player";
    if (!request.playerName && request.playerId) {
      try {
        const player = await User.findById(request.playerId);
        if (player) {
          playerName = player.name;
        }
      } catch (err) {
        console.error("Error getting player name:", err);
      }
    }

    // Create message based on request type
    let message;
    if (request.requestType === "join_session") {
      message = `${playerName} has requested to join your ${request.sessionType} session on ${request.requestedDate} at ${request.requestedTime}`;
    } else {
      message = `${playerName} has requested a new ${request.sessionType} session on ${request.requestedDate} at ${request.requestedTime}`;
    }

    const notificationData = {
      title: "New Session Request",
      message: message,
      type: "request",
      relatedId: request._id,
    };

    console.log(
      `Notifying trainer ${trainerId} about new session request: ${request._id}`
    );

    // Create notification in database
    const notification = await this.createNotification(
      trainerId,
      notificationData
    );

    // Send push notification to device
    await this.sendPushNotifications([trainerId], notificationData);

    return notification;
  } catch (error) {
    console.error("Error notifying about session request:", error);
    throw error;
  }
};

// Send push notifications via Expo Push Service
exports.sendPushNotifications = async (userIds, data) => {
  try {
    // Get users with Expo push tokens
    const users = await User.find({
      _id: { $in: userIds },
      expoPushToken: { $exists: true, $ne: null },
    });

    if (users.length === 0) {
      console.log("No users with Expo push tokens found");
      return;
    }
    // Apply role-based filtering
    const eligibleUsers = users.filter((user) => {
      // For session notifications, only send to users with Player role
      if (
        (data.type === "session" || data.type === "session_announcement") &&
        user.role !== "Player"
      ) {
        console.log(
          `Skipping session notification for non-player user ${user._id} (${user.role})`
        );
        return false;
      }

      // For request notifications, only send to users with Trainer role
      if (data.type === "request" && user.role !== "Trainer") {
        console.log(
          `Skipping request notification for non-trainer user ${user._id} (${user.role})`
        );
        return false;
      }

      // For response notifications, only send to users with Player role
      if (data.type === "response" && user.role !== "Player") {
        console.log(
          `Skipping response notification for non-player user ${user._id} (${user.role})`
        );
        return false;
      }

      return true;
    });

    console.log(
      `After role filtering: ${eligibleUsers.length} eligible users out of ${users.length}`
    );

    if (eligibleUsers.length === 0) {
      console.log("No eligible users for this notification type");
      return [];
    }

    // Create messages only for eligible users
    const messages = eligibleUsers.map((user) => ({
      to: user.expoPushToken,
      sound: "default",
      title: data.title,
      body: data.message,
      data: {
        type: data.type,
        relatedId: data.relatedId.toString(),
        status: data.status,
      },
    }));

    // Chunk the messages to avoid rate limiting
    const chunks = expo.chunkPushNotifications(messages);

    // Send the chunks
    const tickets = [];
    for (let chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
        console.log(`Sent ${ticketChunk.length} push notifications in chunk`);
      } catch (error) {
        console.error("Error sending chunk:", error);
      }
    }

    console.log(`Total push notifications sent: ${tickets.length}`);
    return tickets;
  } catch (error) {
    console.error("Error sending push notifications:", error);
    throw error;
  }
};

// Get notifications for a user
exports.getUserNotifications = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    const notifications = await Notification.find({ userId })
      .sort({ createdAt: -1 })
      .limit(50);

    return res.status(200).json({
      success: true,
      notifications,
    });
  } catch (error) {
    console.error("Error fetching user notifications:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
    });
  }
};

// NEW: Notify trainer about request cancellation
exports.notifyCancellation = async (request) => {
  try {
    const trainerId = request.trainerId;
    if (!trainerId) {
      console.log("No trainer ID found in request, skipping notification");
      return null;
    }

    // Get player name
    let playerName = request.playerName || "A player";
    if (!request.playerName && request.playerId) {
      try {
        const player = await User.findById(request.playerId);
        if (player) {
          playerName = player.name;
        }
      } catch (err) {
        console.error("Error getting player name:", err);
      }
    }

    // Create message based on request type
    let message;
    if (request.requestType === "join_session") {
      message = `${playerName} has cancelled their request to join your ${request.sessionType} session on ${request.requestedDate} at ${request.requestedTime}`;
    } else {
      message = `${playerName} has cancelled their request for a ${request.sessionType} session on ${request.requestedDate} at ${request.requestedTime}`;
    }

    const notificationData = {
      title: "Training Request Cancelled",
      message: message,
      type: "request",
      relatedId: request._id,
      status: "cancelled",
    };

    console.log(
      `Notifying trainer ${trainerId} about cancelled request: ${request._id}`
    );

    // Create notification in database
    const notification = await this.createNotification(
      trainerId,
      notificationData
    );

    // Send push notification to device
    await this.sendPushNotifications([trainerId], notificationData);

    return notification;
  } catch (error) {
    console.error("Error notifying about request cancellation:", error);
    throw error;
  }
};

// Get unread notification count for a user
exports.getUnreadCount = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    const count = await Notification.countDocuments({
      userId,
      read: false,
    });

    return res.status(200).json({
      success: true,
      count,
    });
  } catch (error) {
    console.error("Error fetching unread count:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch unread notification count",
    });
  }
};

// Mark a notification as read
exports.markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID format",
      });
    }

    const notification = await Notification.findByIdAndUpdate(
      notificationId,
      { read: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    return res.status(200).json({
      success: true,
      notification,
    });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to mark notification as read",
    });
  }
};

// Mark all notifications as read for a user
exports.markAllAsRead = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    const result = await Notification.updateMany(
      { userId, read: false },
      { read: true }
    );

    return res.status(200).json({
      success: true,
      message: `Marked ${result.modifiedCount} notifications as read`,
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to mark notifications as read",
    });
  }
};

// Notify manager about club application
exports.notifyClubApplication = async (application) => {
  try {
    const managerId = application.managerId;
    if (!managerId) {
      console.log("No manager ID found in application, skipping notification");
      return null;
    }

    // Get trainer details for more context
    let trainerName = "A trainer";
    try {
      const trainer = await Trainer.findOne({ userId: application.trainerId });
      if (trainer) {
        trainerName = `${trainer.firstName} ${trainer.lastName}`;
      }
    } catch (err) {
      console.error("Error getting trainer name:", err);
    }

    // Create notification message
    const message = `${trainerName} has applied to join ${application.clubName
      } at ${application.turfName}. ${application.certificates.length > 0
        ? `Application includes ${application.certificates.length} certificate(s).`
        : ""
      }`;

    const notificationData = {
      title: "New Club Application",
      message: message,
      type: "request", // Using existing type that fits
      relatedId: application._id,
      status: "pending",
    };

    console.log(
      `Creating notification for manager ${managerId} about club application: ${application._id}`
    );

    // Create notification in database (no push notification since it's web-based)
    const notification = await this.createNotification(
      managerId,
      notificationData
    );

    // Note: Not sending push notifications since managers are on web platform
    console.log(
      `Club application notification stored for web manager: ${managerId}`
    );

    return notification;
  } catch (error) {
    console.error("Error notifying about club application:", error);
    throw error;
  }
};
