const express = require("express");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const { Manager } = require("../Modal/ClubManager");
const { ActivityLog } = require("../Modal/activityLog");
const TurfBooking = require("../Modal/TurfBooking");
const ClubApplication = require("../Modal/TrainerClubApplication");
const router = express.Router();

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: "aakash7536@gmail.com",
    pass: "tmcj fbnn lffr cspa",
  },
});

// Route to create a new manager
router.post("/managers", async (req, res) => {
  const { name, email, password, clubId } = req.body;

  // Validate input
  if (!name || !email || !password) {
    return res
      .status(400)
      .json({ error: "Name, email, and password are required." });
  }

  if (!clubId) {
    return res.status(400).json({ error: "Club ID is required." });
  }

  try {
    // Check if a manager with the given email already exists
    const existingManager = await Manager.findOne({ email });
    if (existingManager) {
      return res.status(400).json({ error: "Email is already in use." });
    }

    // Verify that the clubId exists (optional but recommended)
    const User = require("../Modal/User"); // Import User model
    const clubAdmin = await User.findById(clubId);
    if (!clubAdmin || clubAdmin.role !== "ClubAdmin") {
      return res.status(400).json({ error: "Invalid club ID." });
    }

    // Create new manager with clubId
    const hashedPassword = await bcrypt.hash(password, 10);
    const newManager = new Manager({
      name,
      email,
      password: hashedPassword,
      clubId, // Add clubId to new manager
    });

    await newManager.save();

    // Update login link for development environment
    const loginLink = `exp://192.168.0.147:8082/--/manager-login`;

    // Send email with credentials
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Your Manager Login Link and Credentials",
      text: `Hello ${name},\n\nYour account has been created as a manager for ${clubAdmin.clubName}. You can log in using the following credentials:\n\nEmail: ${email}\nPassword: ${password}\n\nClick the link below to log in:\n${loginLink}\n\nThank you,\nSportszz Team`,
    };

    await transporter.sendMail(mailOptions);

    res.status(201).json({
      message: "Manager added and email sent with credentials!",
      _id: newManager._id, // Return the ID for activity logging
    });
  } catch (error) {
    console.error("Error adding manager or sending email:", error);
    res.status(500).json({
      error: "An error occurred while adding the manager or sending the email.",
    });
  }
});

router.get("/managers/me", async (req, res) => {
  try {
    // Get the manager ID from the request headers
    const managerId = req.headers["manager-id"]; // Expecting manager ID in headers

    // Check if managerId is provided
    if (!managerId) {
      return res.status(401).json({ message: "No manager logged in." });
    }

    // Find the manager using the provided ID
    const manager = await Manager.findById(managerId)
      .select("_id") // Only select the _id field, or add more fields if needed
      .lean(); // Convert to plain JavaScript object

    // If no manager is found, return a 404 response
    if (!manager) {
      return res.status(404).json({ message: "Manager not found" });
    }

    // Return the manager ID in the response
    res.json({ _id: manager._id });
  } catch (error) {
    console.error("Error fetching current manager:", error);
    // Return a 500 status with error message
    res.status(500).json({
      message: "Error fetching manager ID",
      error: error.message,
    });
  }
});

// Fetching managers clubwise
router.get("/club-admin/managers", async (req, res) => {
  try {
    const { clubId } = req.query; // Get clubId from query params

    if (!clubId) {
      return res.status(400).json({ message: "Club ID is required" });
    }

    const managers = await Manager.find({ clubId: clubId });
    res.status(200).json(managers);
  } catch (error) {
    console.error("Error fetching managers:", error);
    res.status(500).json({ message: "Error fetching managers", error });
  }
});

// Activate or Deactivate Manager
router.put("/managers/:id/activate", async (req, res) => {
  const { isActive } = req.body;

  try {
    const manager = await Manager.findById(req.params.id);
    if (!manager) {
      return res.status(404).json({ error: "Manager not found" });
    }

    manager.isActive = isActive;
    await manager.save();

    res.status(200).json({
      message: `Manager ${isActive ? "activated" : "deactivated"} successfully`,
    });
  } catch (error) {
    console.error("Error activating/deactivating manager:", error);
    res.status(500).json({ error: "An error occurred" });
  }
});

// Delete Manager Endpoint
router.delete("/managers/:id", async (req, res) => {
  try {
    const managerId = req.params.id;

    // Find the manager by ID and delete it
    const deletedManager = await Manager.findByIdAndDelete(managerId);

    // Check if the manager was found and deleted
    if (!deletedManager) {
      return res.status(404).json({ message: "Manager not found" });
    }

    // Return a success message
    res.status(200).json({ message: "Manager deleted successfully" });
  } catch (error) {
    console.error("Error deleting manager:", error);
    res
      .status(500)
      .json({ message: "An error occurred while deleting the manager" });
  }
});

// Get manager statistics
router.get("/analytics/manager-stats", async (req, res) => {
  try {
    const { clubId } = req.query;

    if (!clubId) {
      return res.status(400).json({ message: "Club ID is required" });
    }

    const managers = await Manager.find({ clubId: clubId });

    const totalManagers = managers.length;
    const activeManagers = managers.filter((m) => m.isActive).length;
    const inactiveManagers = totalManagers - activeManagers;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const newManagersThisMonth = await Manager.countDocuments({
      clubId: clubId,
      createdAt: { $gte: startOfMonth },
    });

    res.status(200).json({
      totalManagers,
      activeManagers,
      inactiveManagers,
      newManagersThisMonth,
      avgResponseTime: 0, // Calculate if needed
    });
  } catch (error) {
    console.error("Error fetching manager statistics:", error);
    res
      .status(500)
      .json({ message: "Error fetching statistics", error: error.message });
  }
});

// Get recent activity log
router.get("/activity-log", async (req, res) => {
  try {
    const { timeRange = "week", page = 1, limit = 10 } = req.query;

    // Determine the date range
    let dateFilter;
    const now = new Date();

    switch (timeRange) {
      case "day":
        dateFilter = { $gte: new Date(now.setDate(now.getDate() - 1)) };
        break;
      case "month":
        dateFilter = { $gte: new Date(now.setMonth(now.getMonth() - 1)) };
        break;
      case "week":
      default:
        dateFilter = { $gte: new Date(now.setDate(now.getDate() - 7)) };
    }

    // Get total count for pagination
    const totalCount = await ActivityLog.countDocuments({
      createdAt: dateFilter,
    });

    // Get activity logs with pagination
    const activities = await ActivityLog.find({
      createdAt: dateFilter,
    })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate("managerId", "name")
      .lean();

    // Format the results
    const formattedActivities = activities.map((activity) => ({
      id: activity._id,
      type: activity.type,
      manager: activity.managerId?.name || "Unknown",
      time: activity.createdAt,
      description: activity.description,
    }));

    res.status(200).json({
      activities: formattedActivities,
      pagination: {
        totalItems: totalCount,
        totalPages: Math.ceil(totalCount / limit),
        currentPage: parseInt(page),
        itemsPerPage: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Error fetching activity log:", error);
    res
      .status(500)
      .json({ message: "Error fetching activity log", error: error.message });
  }
});

// Clear activity logs
router.delete("/activity-log", async (req, res) => {
  try {
    const { timeRange = "week" } = req.query;

    // Determine the date range to delete
    let dateFilter;
    const now = new Date();

    switch (timeRange) {
      case "day":
        dateFilter = { $gte: new Date(now.setDate(now.getDate() - 1)) };
        break;
      case "month":
        dateFilter = { $gte: new Date(now.setMonth(now.getMonth() - 1)) };
        break;
      case "week":
      default:
        dateFilter = { $gte: new Date(now.setDate(now.getDate() - 7)) };
    }

    // Delete activities within the time range
    const result = await ActivityLog.deleteMany({
      createdAt: dateFilter,
    });

    res.status(200).json({
      message: "Activity logs cleared successfully",
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("Error clearing activity logs:", error);
    res.status(500).json({
      message: "Error clearing activity logs",
      error: error.message,
    });
  }
});

// Log a new activity
router.post("/activity-log", async (req, res) => {
  try {
    const { managerId, type, description, metadata } = req.body;

    const newActivity = new ActivityLog({
      managerId,
      type,
      description,
      metadata,
      createdAt: new Date(),
    });

    await newActivity.save();

    res.status(201).json({ message: "Activity logged successfully" });
  } catch (error) {
    console.error("Error logging activity:", error);
    res
      .status(500)
      .json({ message: "Error logging activity", error: error.message });
  }
});

// Get manager status trend over time
router.get("/analytics/manager-status-trend", async (req, res) => {
  try {
    // Get time period from query params (default to last 6 months)
    const { months = 6 } = req.query;
    const monthsAgo = new Date();
    monthsAgo.setMonth(monthsAgo.getMonth() - parseInt(months));

    // Get all status changes from activity log
    const statusChanges = await ActivityLog.aggregate([
      {
        $match: {
          type: "status",
          createdAt: { $gte: monthsAgo },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          statusChanges: {
            $push: {
              managerId: "$managerId",
              newStatus: "$metadata.newStatus",
              createdAt: "$createdAt",
            },
          },
        },
      },
      {
        $sort: { "_id.year": 1, "_id.month": 1 },
      },
    ]);

    // Get monthly snapshots of active/inactive counts
    const monthlySnapshots = [];

    // Get initial counts from before the period
    const initialManagerStates = await Manager.aggregate([
      {
        $match: {
          createdAt: { $lt: monthsAgo },
        },
      },
      {
        $group: {
          _id: "$isActive",
          count: { $sum: 1 },
        },
      },
    ]);

    let activeCount = 0;
    let inactiveCount = 0;

    initialManagerStates.forEach((state) => {
      if (state._id === true) activeCount = state.count;
      if (state._id === false) inactiveCount = state.count;
    });

    // Process each month's data
    for (let i = 0; i < parseInt(months); i++) {
      const targetMonth = new Date(monthsAgo);
      targetMonth.setMonth(targetMonth.getMonth() + i);

      const year = targetMonth.getFullYear();
      const month = targetMonth.getMonth() + 1;

      // Find status changes for this month
      const monthData = statusChanges.find(
        (item) => item._id.year === year && item._id.month === month
      );

      if (monthData) {
        // Process each status change
        monthData.statusChanges.forEach((change) => {
          if (change.newStatus === true) {
            activeCount++;
            inactiveCount--;
          } else {
            activeCount--;
            inactiveCount++;
          }
        });
      }

      // Add new managers created this month
      const newManagers = await Manager.aggregate([
        {
          $match: {
            createdAt: {
              $gte: new Date(year, month - 1, 1),
              $lt: new Date(year, month, 0),
            },
          },
        },
        {
          $group: {
            _id: "$isActive",
            count: { $sum: 1 },
          },
        },
      ]);

      newManagers.forEach((state) => {
        if (state._id === true) activeCount += state.count;
        if (state._id === false) inactiveCount += state.count;
      });

      // Add to monthly snapshots
      monthlySnapshots.push({
        month: `${targetMonth.toLocaleString("default", {
          month: "short",
        })} ${year}`,
        active: activeCount,
        inactive: inactiveCount,
        total: activeCount + inactiveCount,
      });
    }

    res.status(200).json(monthlySnapshots);
  } catch (error) {
    console.error("Error fetching manager status trend:", error);
    res.status(500).json({
      message: "Error fetching status trend data",
      error: error.message,
    });
  }
});

// Update payment status of the turf
router.put("/turf-bookings/:bookingId/payment-status", async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { paymentStatus, paymentMethod } = req.body;

    // Validate input
    if (
      !paymentStatus ||
      !["paid", "pending", "failed"].includes(paymentStatus)
    ) {
      return res.status(400).json({
        error: "Valid payment status is required (paid, pending, failed)",
      });
    }

    // Find and update the booking
    const booking = await TurfBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const oldStatus = booking.paymentStatus; // Store old status

    // Update payment status
    booking.paymentStatus = paymentStatus;
    if (paymentMethod) {
      booking.paymentMethod = paymentMethod;
    }

    await booking.save();

    // Log the activity only if managerId is valid
    const managerId = req.headers["manager-id"];
    if (
      managerId &&
      managerId !== "null" &&
      mongoose.Types.ObjectId.isValid(managerId)
    ) {
      try {
        const activityLog = new ActivityLog({
          managerId: managerId,
          type: "update", // Use existing enum value instead of "payment_update"
          description: `Payment status updated from ${oldStatus} to ${paymentStatus} for booking ${bookingId}`,
          metadata: {
            bookingId,
            oldStatus: oldStatus,
            newStatus: paymentStatus,
            paymentMethod: paymentMethod,
          },
        });
        await activityLog.save();
      } catch (logError) {
        console.warn("Failed to log activity:", logError.message);
        // Continue without failing the main operation
      }
    }

    res.status(200).json({
      message: "Payment status updated successfully",
      booking: {
        _id: booking._id,
        paymentStatus: booking.paymentStatus,
        paymentMethod: booking.paymentMethod,
      },
    });
  } catch (error) {
    console.error("Error updating payment status:", error);
    res.status(500).json({
      error: "An error occurred while updating payment status",
    });
  }
});

// Get trainer applications for a manager - WITH DEBUGGING
router.get("/trainer-applications", async (req, res) => {
  try {
    const { managerId, status = "pending" } = req.query;

    console.log("=== TRAINER APPLICATIONS DEBUG START ===");
    console.log("Request params:", { managerId, status });

    if (!managerId) {
      return res.status(400).json({ message: "Manager ID is required" });
    }

    const ClubApplication = require("../Modal/TrainerClubApplication");
    const User = require("../Modal/User");

    // Debug: Check if trainers exist in database
    const trainerCount = await User.countDocuments({ role: "Trainer" });
    console.log(`Total trainers in database: ${trainerCount}`);

    // Get some sample trainer IDs
    const sampleTrainers = await User.find({ role: "Trainer" })
      .limit(3)
      .select("_id name email role");
    console.log("Sample trainers:", sampleTrainers);

    // Debug: Check total applications
    const totalApplications = await ClubApplication.countDocuments();
    console.log(`Total applications in database: ${totalApplications}`);

    // Debug: Check applications for this manager
    const managerApplications = await ClubApplication.countDocuments({
      assignedManagers: {
        $elemMatch: {
          managerId: managerId,
          status: status,
        },
      },
    });
    console.log(
      `Applications for manager ${managerId} with status ${status}: ${managerApplications}`
    );

    const applications = await ClubApplication.find({
      assignedManagers: {
        $elemMatch: {
          managerId: managerId,
          status: status,
        },
      },
    })
      .populate({
        path: "trainerId",
        select: "name email role",
        model: "User",
      })
      .populate({
        path: "clubId",
        select: "clubName",
        model: "User",
      })
      .populate({
        path: "turfId",
        select: "name",
      })
      .sort({ appliedAt: -1 });

    console.log("Raw applications found:", applications.length);

    // Debug each application
    applications.forEach((app, index) => {
      console.log(`\n--- Application ${index + 1} ---`);
      console.log("Application ID:", app._id);
      console.log("trainerId (raw):", app.trainerId);
      console.log("trainerId type:", typeof app.trainerId);
      console.log(
        "trainerId populated?:",
        app.trainerId && typeof app.trainerId === "object" ? "YES" : "NO"
      );
      if (app.trainerId && typeof app.trainerId === "object") {
        console.log("Trainer details:", {
          id: app.trainerId._id,
          name: app.trainerId.name,
          email: app.trainerId.email,
          role: app.trainerId.role,
        });
      }
      console.log("clubId:", app.clubId);
      console.log("turfId:", app.turfId);
      console.log("assignedManagers:", app.assignedManagers);
    });

    // Transform the data to include manager-specific status
    const transformedApplications = applications.map((app) => {
      const managerData = app.assignedManagers.find(
        (m) => m.managerId.toString() === managerId
      );

      console.log(`\nTransforming application ${app._id}:`);
      console.log("Manager data found:", managerData);

      const transformed = {
        ...app.toObject(),
        managerStatus: managerData?.status || "pending",
        managerReviewedAt: managerData?.reviewedAt,
        managerRejectionReason: managerData?.rejectionReason,
      };

      console.log("Transformed trainer info:", {
        trainerId: transformed.trainerId,
        trainerName: transformed.trainerId?.name,
      });

      return transformed;
    });

    console.log(
      `Final result: ${transformedApplications.length} applications for manager ${managerId}`
    );
    console.log("=== TRAINER APPLICATIONS DEBUG END ===\n");

    res.json(transformedApplications);
  } catch (error) {
    console.error("Error fetching trainer applications:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Approve/Reject trainer application - WITH DEBUGGING
router.put("/trainer-applications/:id/:action", async (req, res) => {
  try {
    const { id, action } = req.params;
    const { rejectionReason } = req.body;
    const managerId = req.headers["manager-id"];

    console.log("=== APPLICATION ACTION DEBUG START ===");
    console.log("Request params:", { id, action, managerId });
    console.log("Request body:", { rejectionReason });

    const application = await ClubApplication.findById(id);
    if (!application) {
      console.log("Application not found for ID:", id);
      return res.status(404).json({ message: "Application not found" });
    }

    console.log("Found application:", {
      id: application._id,
      trainerId: application.trainerId,
      assignedManagers: application.assignedManagers,
    });

    // Find the specific manager in the assignedManagers array
    const managerIndex = application.assignedManagers.findIndex(
      (m) => m.managerId.toString() === managerId
    );

    console.log("Manager index in assignedManagers:", managerIndex);

    if (managerIndex === -1) {
      console.log("Manager not found in assignedManagers array");
      return res
        .status(403)
        .json({ message: "Not authorized to review this application" });
    }

    console.log(
      "Before update - Manager data:",
      application.assignedManagers[managerIndex]
    );

    // Update the specific manager's status
    application.assignedManagers[managerIndex].status =
      action === "approve" ? "approved" : "rejected";
    application.assignedManagers[managerIndex].reviewedAt = new Date();
    application.assignedManagers[managerIndex].reviewedBy = managerId;

    if (rejectionReason && action === "reject") {
      application.assignedManagers[managerIndex].rejectionReason =
        rejectionReason;
    }

    console.log(
      "After update - Manager data:",
      application.assignedManagers[managerIndex]
    );

    // Update overall status based on all managers' decisions
    const allManagers = application.assignedManagers;
    const approvedCount = allManagers.filter(
      (m) => m.status === "approved"
    ).length;
    const rejectedCount = allManagers.filter(
      (m) => m.status === "rejected"
    ).length;

    console.log("Status counts:", {
      approvedCount,
      rejectedCount,
      total: allManagers.length,
    });

    const oldOverallStatus = application.overallStatus;

    if (approvedCount > 0) {
      application.overallStatus = "approved"; // Any approval approves the application
    } else if (rejectedCount === allManagers.length) {
      application.overallStatus = "rejected"; // All rejected = overall rejected
    } else {
      application.overallStatus = "pending"; // Still pending
    }

    console.log("Overall status change:", {
      from: oldOverallStatus,
      to: application.overallStatus,
    });

    await application.save();

    console.log("Application saved successfully");
    console.log("=== APPLICATION ACTION DEBUG END ===\n");

    res.json({
      message: `Application ${action}d successfully`,
      application,
      overallStatus: application.overallStatus,
    });
  } catch (error) {
    console.error(`Error ${action}ing application:`, error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
