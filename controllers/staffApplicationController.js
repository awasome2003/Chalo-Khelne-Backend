/**
 * StaffApplicationController — Handles the full lifecycle of tournament staff applications.
 *
 * Player-side (mobile):
 *   - Browse tournaments with openings
 *   - Apply to a tournament as trainer/referee/etc.
 *   - View & withdraw own applications
 *
 * Manager-side (web):
 *   - View incoming applications
 *   - Accept/reject with optional note
 *   - See applicant's full service profile
 */

const StaffApplication = require("../Modal/StaffApplication");
const Tournament = require("../Modal/Tournament");
const User = require("../Modal/User");
const Trainer = require("../Modal/Trainer");
const Referee = require("../Modal/Referee");
const notificationController = require("./notificationController");

const staffApplicationController = {
  // ═══════════════════════════════════════════
  // PLAYER SIDE — Apply, View, Withdraw
  // ═══════════════════════════════════════════

  /**
   * POST /staff-applications/apply
   * Player applies for a role in a tournament
   */
  apply: async (req, res) => {
    try {
      const { userId, tournamentId, role, message, rateAmount, rateType } = req.body;

      if (!userId || !tournamentId || !role) {
        return res.status(400).json({ success: false, message: "userId, tournamentId, and role are required" });
      }

      // Validate tournament exists
      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        return res.status(404).json({ success: false, message: "Tournament not found" });
      }

      // Validate user exists
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      // Check for existing application (unique constraint will also catch this)
      const existing = await StaffApplication.findOne({ userId, tournamentId, role });
      if (existing) {
        return res.status(409).json({
          success: false,
          message: `You've already applied as ${role} for this tournament`,
          application: existing,
        });
      }

      // Fetch service profile if available
      let serviceProfileId = null;
      let sports = [];
      let experience = 0;

      if (role === "trainer") {
        const trainerProfile = await Trainer.findOne({ userId });
        if (trainerProfile) {
          serviceProfileId = trainerProfile._id;
          sports = trainerProfile.sports || [];
          experience = trainerProfile.experience || 0;
        }
      } else if (role === "referee") {
        const refereeProfile = await Referee.findOne({ userId });
        if (refereeProfile) {
          serviceProfileId = refereeProfile._id;
          sports = refereeProfile.sports || [];
          experience = refereeProfile.experience || 0;
        }
      }

      const application = new StaffApplication({
        userId,
        userName: user.name,
        userEmail: user.email,
        userPhone: user.mobile?.toString() || "",
        userProfileImage: user.profileImage || null,
        role,
        tournamentId,
        tournamentName: tournament.title,
        managerId: tournament.managerId?.[0] || null,
        rateAmount: rateAmount || null,
        rateType: rateType || null,
        message: message || "",
        sports,
        experience,
        serviceProfileId,
      });

      await application.save();

      // Send notification to manager
      try {
        const managerId = tournament.managerId?.[0];
        if (managerId) {
          await notificationController.createNotification(managerId, {
            title: "New Staff Application",
            message: `${user.name} applied as ${role} for "${tournament.title}"`,
            type: "staff_application",
            relatedId: application._id,
          });
          // Send push notification
          await notificationController.sendPushNotifications([managerId], {
            title: "New Staff Application",
            message: `${user.name} applied as ${role} for "${tournament.title}"`,
            type: "staff_application",
          });
        }
      } catch (notifErr) {
        console.error("[STAFF_APPLICATION] Notification error (non-blocking):", notifErr.message);
      }

      res.status(201).json({
        success: true,
        message: `Application submitted as ${role}`,
        application,
      });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ success: false, message: "Duplicate application" });
      }
      console.error("[STAFF_APPLICATION] Apply error:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * GET /staff-applications/my/:userId
   * Get all applications by a user
   */
  getMyApplications: async (req, res) => {
    try {
      const { userId } = req.params;
      const applications = await StaffApplication.find({ userId })
        .populate("tournamentId", "title sportsType startDate endDate")
        .sort({ createdAt: -1 });

      res.json({ success: true, applications });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * PUT /staff-applications/:applicationId/withdraw
   * Player withdraws their application
   */
  withdraw: async (req, res) => {
    try {
      const { applicationId } = req.params;
      const application = await StaffApplication.findById(applicationId);

      if (!application) {
        return res.status(404).json({ success: false, message: "Application not found" });
      }
      if (application.status !== "pending") {
        return res.status(400).json({ success: false, message: `Cannot withdraw — status is ${application.status}` });
      }

      application.status = "withdrawn";
      await application.save();

      res.json({ success: true, message: "Application withdrawn", application });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // ═══════════════════════════════════════════
  // MANAGER SIDE — View, Accept, Reject
  // ═══════════════════════════════════════════

  /**
   * GET /staff-applications/tournament/:tournamentId
   * Get all applications for a tournament (manager view)
   */
  getByTournament: async (req, res) => {
    try {
      const { tournamentId } = req.params;
      const { status, role } = req.query;

      const filter = { tournamentId };
      if (status) filter.status = status;
      if (role) filter.role = role;

      const applications = await StaffApplication.find(filter)
        .populate("userId", "name email mobile profileImage role")
        .sort({ createdAt: -1 });

      // Group by role
      const grouped = {};
      applications.forEach((app) => {
        if (!grouped[app.role]) grouped[app.role] = [];
        grouped[app.role].push(app);
      });

      res.json({
        success: true,
        total: applications.length,
        pending: applications.filter((a) => a.status === "pending").length,
        applications,
        grouped,
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * GET /staff-applications/:applicationId/profile
   * Get applicant's full service profile (for manager review)
   */
  getApplicantProfile: async (req, res) => {
    try {
      const { applicationId } = req.params;
      const application = await StaffApplication.findById(applicationId)
        .populate("userId", "name email mobile profileImage role sex dateOfBirth address");

      if (!application) {
        return res.status(404).json({ success: false, message: "Application not found" });
      }

      let serviceProfile = null;
      if (application.role === "trainer" && application.serviceProfileId) {
        serviceProfile = await Trainer.findById(application.serviceProfileId);
      } else if (application.role === "referee" && application.serviceProfileId) {
        serviceProfile = await Referee.findById(application.serviceProfileId);
      }

      res.json({
        success: true,
        application,
        serviceProfile,
        user: application.userId,
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * PUT /staff-applications/:applicationId/accept
   * Manager accepts an application
   */
  accept: async (req, res) => {
    try {
      const { applicationId } = req.params;
      const { managerNote, managerId, stages } = req.body;

      const application = await StaffApplication.findById(applicationId);
      if (!application) {
        return res.status(404).json({ success: false, message: "Application not found" });
      }
      if (application.status !== "pending") {
        return res.status(400).json({ success: false, message: `Already ${application.status}` });
      }

      application.status = "accepted";
      application.managerNote = managerNote || "";
      application.respondedAt = new Date();
      application.respondedBy = managerId || null;

      // Phase 4d: save stage grants for referee applications.
      // Values must be a subset of ["group-stage", "knockout"].
      // Empty array = "all stages allowed" (backward compat for clients that don't send stages).
      if (application.role === "referee" && Array.isArray(stages)) {
        const allowed = new Set(["group-stage", "knockout"]);
        application.stages = stages.filter((s) => allowed.has(s));
      }

      await application.save();

      // Notify the applicant
      try {
        await notificationController.createNotification(application.userId, {
          title: "Application Accepted!",
          message: `You've been accepted as ${application.role} for "${application.tournamentName}"${managerNote ? ` — "${managerNote}"` : ""}`,
          type: "staff_application_accepted",
          relatedId: application._id,
        });
        await notificationController.sendPushNotifications([application.userId], {
          title: "Application Accepted! 🎉",
          message: `You've been accepted as ${application.role} for "${application.tournamentName}"`,
          type: "staff_application_accepted",
        });
      } catch (notifErr) {
        console.error("[STAFF_APPLICATION] Accept notification error:", notifErr.message);
      }

      res.json({ success: true, message: `${application.userName} accepted as ${application.role}`, application });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * PUT /staff-applications/:applicationId/reject
   * Manager rejects an application
   */
  reject: async (req, res) => {
    try {
      const { applicationId } = req.params;
      const { managerNote, managerId } = req.body;

      const application = await StaffApplication.findById(applicationId);
      if (!application) {
        return res.status(404).json({ success: false, message: "Application not found" });
      }
      if (application.status !== "pending") {
        return res.status(400).json({ success: false, message: `Already ${application.status}` });
      }

      application.status = "rejected";
      application.managerNote = managerNote || "";
      application.respondedAt = new Date();
      application.respondedBy = managerId || null;
      await application.save();

      // Notify the applicant
      try {
        await notificationController.createNotification(application.userId, {
          title: "Application Update",
          message: `Your ${application.role} application for "${application.tournamentName}" was not accepted${managerNote ? ` — "${managerNote}"` : ""}`,
          type: "staff_application_rejected",
          relatedId: application._id,
        });
        await notificationController.sendPushNotifications([application.userId], {
          title: "Application Update",
          message: `Your ${application.role} application for "${application.tournamentName}" was not accepted`,
          type: "staff_application_rejected",
        });
      } catch (notifErr) {
        console.error("[STAFF_APPLICATION] Reject notification error:", notifErr.message);
      }

      res.json({ success: true, message: "Application rejected", application });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * PUT /staff-applications/:applicationId/verify
   * Manager verifies an applicant's profile (marks credentials as checked)
   */
  verify: async (req, res) => {
    try {
      const { applicationId } = req.params;
      const { managerId, verificationNote, isVerified } = req.body;

      const application = await StaffApplication.findById(applicationId);
      if (!application) {
        return res.status(404).json({ success: false, message: "Application not found" });
      }

      application.isVerified = isVerified !== false;
      application.verifiedAt = new Date();
      application.verifiedBy = managerId || null;
      application.verificationNote = verificationNote || "";
      await application.save();

      res.json({
        success: true,
        message: isVerified !== false ? "Profile verified" : "Verification revoked",
        application,
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * GET /staff-applications/tournament/:tournamentId/accepted
   * Get accepted staff for a tournament (final staff list)
   */
  getAcceptedStaff: async (req, res) => {
    try {
      const { tournamentId } = req.params;
      const staff = await StaffApplication.find({ tournamentId, status: "accepted" })
        .populate("userId", "name email mobile profileImage")
        .sort({ role: 1 });

      const grouped = {};
      staff.forEach((s) => {
        if (!grouped[s.role]) grouped[s.role] = [];
        grouped[s.role].push(s);
      });

      res.json({ success: true, total: staff.length, staff, grouped });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * GET /staff-applications/manager/:managerId/pending?status=pending&role=trainer
   * Get applications across all manager's tournaments (with optional filters)
   */
  getManagerPending: async (req, res) => {
    try {
      const { managerId } = req.params;
      const { status, role } = req.query;

      // Find all tournaments by this manager
      const tournaments = await Tournament.find({
        $or: [
          { managerId: { $in: [managerId] } },
          { managerId: managerId },
        ],
      }).select("_id title managerId");

      const tournamentIds = tournaments.map((t) => t._id);

      // Also find applications that directly reference this managerId
      const directApps = await StaffApplication.find({ managerId }).select("_id tournamentId");
      const directAppTournamentIds = directApps.map(a => a.tournamentId);
      const allTournamentIds = [...new Set([...tournamentIds.map(String), ...directAppTournamentIds.map(String)])];

      // Search by tournament IDs OR direct managerId on the application
      const filter = {
        $or: [
          { tournamentId: { $in: tournamentIds } },
          { managerId: managerId },
        ],
      };
      if (status) filter.status = status;
      if (role) filter.role = role;

      const applications = await StaffApplication.find(filter)
        .populate("userId", "name email mobile profileImage role")
        .populate("tournamentId", "title sportsType startDate")
        .sort({ createdAt: -1 });

      const pending = applications.filter((a) => a.status === "pending").length;

      res.json({
        success: true,
        total: applications.length,
        pending,
        applications,
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
};

module.exports = staffApplicationController;
