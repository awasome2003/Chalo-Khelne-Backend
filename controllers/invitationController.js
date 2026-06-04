const Invitation = require("../Modal/Invitation");
const User = require("../Modal/User");
const Tournament = require("../Modal/Tournament");
const mongoose = require("mongoose");
const { parsePagination } = require("../utils/pagination");

const invitationController = {
  /**
   * POST /api/invitations/send
   * Send a tournament invitation to another player.
   */
  send: async (req, res) => {
    try {
      const {
        sender_id,
        receiver_id, // legacy single
        receiver_ids, // new bulk array
        tournament_id,
        invitationType = "tournament",
        tournamentName,
        sport,
        eventDate,
        startTime,
        endTime,
        venue,
        message,
      } = req.body;

      // Normalize receivers to an array (supports both single + bulk callers)
      const receivers = Array.isArray(receiver_ids) && receiver_ids.length
        ? receiver_ids
        : receiver_id
        ? [receiver_id]
        : [];

      if (!sender_id || receivers.length === 0) {
        return res.status(400).json({
          success: false,
          message: "sender_id and at least one receiver are required",
        });
      }

      if (!mongoose.Types.ObjectId.isValid(sender_id)) {
        return res.status(400).json({ success: false, message: "Invalid sender id" });
      }

      const sender = await User.findById(sender_id).select("name");
      if (!sender) {
        return res.status(404).json({ success: false, message: "Sender not found" });
      }

      // Optional tournament — only required/validated for tournament-type invites
      let tournament = null;
      if (tournament_id) {
        if (!mongoose.Types.ObjectId.isValid(tournament_id)) {
          return res.status(400).json({ success: false, message: "Invalid tournament id" });
        }
        tournament = await Tournament.findById(tournament_id).select(
          "title startDate endDate status"
        );
        if (!tournament) {
          return res.status(404).json({ success: false, message: "Tournament not found" });
        }
        if (tournament.endDate && new Date(tournament.endDate) < new Date()) {
          return res
            .status(400)
            .json({ success: false, message: "Cannot invite to an expired tournament" });
        }
      }

      // A single send to many players shares one batchId so the Sent tab can group them
      const batchId =
        receivers.length > 1 ? new mongoose.Types.ObjectId().toString() : null;

      const io = req.app.get("io");
      const skipped = [];

      // 1) Validate + de-duplicate the receiver ids up front (no DB calls).
      const seen = new Set();
      const candidateIds = [];
      for (const rid of receivers) {
        if (!mongoose.Types.ObjectId.isValid(rid)) {
          skipped.push({ rid, reason: "invalid id" });
          continue;
        }
        if (String(rid) === String(sender_id)) {
          skipped.push({ rid, reason: "self" });
          continue;
        }
        if (seen.has(String(rid))) {
          skipped.push({ rid, reason: "duplicate" });
          continue;
        }
        seen.add(String(rid));
        candidateIds.push(rid);
      }

      // 2) Batch-load all receivers in ONE query (was N findById calls).
      const receiverDocs = await User.find({ _id: { $in: candidateIds } })
        .select("name")
        .lean();
      const receiverMap = new Map(receiverDocs.map((u) => [String(u._id), u.name]));

      // 3) Batch-load existing tournament duplicates in ONE query (was N findOne calls).
      let existingSet = new Set();
      if (tournament_id) {
        const existing = await Invitation.find({
          senderId: sender_id,
          tournamentId: tournament_id,
          receiverId: { $in: candidateIds },
        })
          .select("receiverId")
          .lean();
        existingSet = new Set(existing.map((d) => String(d.receiverId)));
      }

      // 4) Build the documents to insert.
      const docs = [];
      for (const rid of candidateIds) {
        if (!receiverMap.has(String(rid))) {
          skipped.push({ rid, reason: "not found" });
          continue;
        }
        if (tournament_id && existingSet.has(String(rid))) {
          skipped.push({ rid, reason: "duplicate" });
          continue;
        }
        docs.push({
          senderId: sender_id,
          senderName: sender.name,
          receiverId: rid,
          receiverName: receiverMap.get(String(rid)) || "",
          invitationType,
          tournamentId: tournament_id || null,
          tournamentName: tournament?.title || tournamentName || "",
          sport: sport || "",
          eventDate: eventDate || "",
          startTime: startTime || "",
          endTime: endTime || "",
          venue: venue || "",
          batchId,
          message: message?.trim() || "",
        });
      }

      // 5) Bulk insert in ONE query. ordered:false → unique-index collisions are
      //    skipped (reported) instead of aborting the whole batch.
      let created = [];
      if (docs.length) {
        try {
          created = await Invitation.insertMany(docs, { ordered: false });
        } catch (e) {
          created = e.insertedDocs || [];
          (e.writeErrors || []).forEach((we) => {
            const op = we.err?.op || {};
            skipped.push({ rid: op.receiverId, reason: "duplicate" });
          });
          // A non-duplicate failure with nothing inserted is a real error.
          if (!created.length && !(e.writeErrors && e.writeErrors.length)) throw e;
        }
      }

      // 6) Emit socket notifications (in-memory; not a DB call, safe to loop).
      if (io) {
        created.forEach((invitation) => {
          io.to(`user_${invitation.receiverId}`).emit("invitation:new", {
            _id: invitation._id,
            senderName: sender.name,
            tournamentName: invitation.tournamentName,
            invitationType,
            message: message?.trim() || "",
          });
        });
      }

      if (created.length === 0) {
        return res.status(409).json({
          success: false,
          message: "No invitations sent (already invited or invalid players).",
          skipped,
        });
      }

      res.status(201).json({
        success: true,
        message: `Invitation sent to ${created.length} player${
          created.length > 1 ? "s" : ""
        }`,
        count: created.length,
        invitations: created,
        skipped,
      });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({
          success: false,
          message: "Invitation already exists for this player and tournament",
        });
      }
      console.error("[INVITATION] Send error:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * GET /api/invitations/default-players
   * A starter list of players to invite (shown before the user searches).
   */
  getDefaultPlayers: async (req, res) => {
    try {
      const requesterId = req.user?.id || req.user?._id;
      const filter = { isActive: true };
      if (requesterId) filter._id = { $ne: requesterId };

      const players = await User.find(filter)
        .select("name profileImage sports address role")
        .sort({ updatedAt: -1 })
        .limit(20)
        .lean();

      res.json({ success: true, players });
    } catch (err) {
      console.error("[INVITATION] Default players error:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * GET /api/invitations/received/:playerId
   * Get all invitations received by a player.
   */
  getReceived: async (req, res) => {
    try {
      const { playerId } = req.params;
      const { status } = req.query;

      const filter = { receiverId: playerId };
      if (status && ["pending", "accepted", "rejected"].includes(status)) {
        filter.status = status;
      }

      const { page, limit, skip } = parsePagination(req);
      const invitations = await Invitation.find(filter)
        .populate("senderId", "name profileImage")
        .populate("tournamentId", "title startDate endDate sportsType entryFee")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      // Count unread (pending) — full count, independent of the page
      const pendingCount = await Invitation.countDocuments({
        receiverId: playerId,
        status: "pending",
      });

      res.json({
        success: true,
        invitations,
        pendingCount,
        page,
        hasMore: invitations.length === limit,
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * GET /api/invitations/sent/:playerId
   * Get all invitations sent by a player.
   */
  getSent: async (req, res) => {
    try {
      const { playerId } = req.params;

      const { page, limit, skip } = parsePagination(req);
      const invitations = await Invitation.find({ senderId: playerId })
        .populate("receiverId", "name profileImage")
        .populate("tournamentId", "title startDate endDate sportsType")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      res.json({ success: true, invitations, page, hasMore: invitations.length === limit });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * POST /api/invitations/respond
   * Accept or reject an invitation.
   */
  respond: async (req, res) => {
    try {
      const { invitation_id, status } = req.body;

      if (!invitation_id || !status) {
        return res.status(400).json({
          success: false,
          message: "invitation_id and status are required",
        });
      }

      if (!["accepted", "rejected"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'status must be "accepted" or "rejected"',
        });
      }

      // Atomically claim the pending→responded transition (idempotent under
      // concurrent accept/reject taps → no double-response notifications).
      const invitation = await Invitation.findOneAndUpdate(
        { _id: invitation_id, status: "pending" },
        { $set: { status, respondedAt: new Date() } },
        { new: true }
      );
      if (!invitation) {
        const existing = await Invitation.findById(invitation_id).select("status").lean();
        if (!existing) {
          return res.status(404).json({ success: false, message: "Invitation not found" });
        }
        return res.status(400).json({
          success: false,
          message: `Invitation already ${existing.status}`,
        });
      }

      // Notify sender via socket
      const io = req.app.get("io");
      if (io) {
        io.to(`user_${invitation.senderId}`).emit("invitation:response", {
          _id: invitation._id,
          receiverName: invitation.receiverName,
          tournamentName: invitation.tournamentName,
          status,
        });
      }

      res.json({
        success: true,
        message: `Invitation ${status}`,
        invitation,
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * GET /api/invitations/tournament/:tournamentId
   * Get all invitations for a tournament (for managers/organizers).
   */
  getByTournament: async (req, res) => {
    try {
      const { tournamentId } = req.params;

      const { page, limit, skip } = parsePagination(req);
      const invitations = await Invitation.find({ tournamentId })
        .populate("senderId", "name")
        .populate("receiverId", "name profileImage")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      res.json({ success: true, invitations, page, hasMore: invitations.length === limit });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * GET /api/invitations/pending-count/:playerId
   * Get count of pending invitations (for badge).
   */
  getPendingCount: async (req, res) => {
    try {
      const count = await Invitation.countDocuments({
        receiverId: req.params.playerId,
        status: "pending",
      });
      res.json({ success: true, count });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
};

module.exports = invitationController;
