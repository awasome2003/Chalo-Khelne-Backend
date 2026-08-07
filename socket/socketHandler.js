const jwt = require("jsonwebtoken");
const Tournament = require("../src/modules/tournaments/models/Tournament");
const Booking = require("../src/modules/tournaments/models/BookingModel");
const Manager = require("../src/modules/identity/models/ClubManager").Manager;
const { findMatchById } = require("../utils/matchUtils");
const {
  canJoinGroupChat,
  canJoinConversation,
} = require("../utils/chatMembership");

module.exports = function setupSocket(io) {
  // ── Authenticate + resolve tenant for the socket ─────────────────────
  // Mirrors the HTTP auth: besides userId we resolve the principal's tenant
  // (clubId) + role so room joins can enforce ownership. Socket handlers run
  // OUTSIDE any AsyncLocalStorage tenant context, so the tenantScope plugin
  // does NOT auto-scope the lookups below — that's intentional: we read the
  // target record cross-tenant precisely to decide if THIS socket may join.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error("Authentication required"));
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
      // Support both Player JWT (decoded.id) and Manager/Superadmin (decoded.userId)
      socket.userId = decoded.id || decoded.userId;
      if (!socket.userId) return next(new Error("Invalid token payload"));

      const role = decoded.role || null;
      socket.role = role;
      socket.isSuperAdmin = role === "superadmin";

      // Tenant root: owner roles scope to their own id; a Manager scopes to its
      // owning ClubAdmin (manager.clubId); players/trainers/referees are
      // cross-tenant (no clubId).
      if (role === "ClubAdmin" || role === "corporate_admin") {
        socket.clubId = String(socket.userId);
      } else if (role === "Manager") {
        const mgr = await Manager.findById(socket.userId).select("clubId").lean();
        socket.clubId = mgr && mgr.clubId ? String(mgr.clubId) : null;
      } else {
        socket.clubId = null;
      }
      next();
    } catch (_) {
      next(new Error("Invalid token"));
    }
  });

  // Can this socket join a tournament's realtime room?
  //  • public tournament  → yes (spectators watch live scores)
  //  • private tournament → only SuperAdmin, the owning club, an assigned
  //    manager, or a registered participant (Booking).
  async function canJoinTournamentRoom(socket, tournamentId) {
    if (!tournamentId) return false;
    if (socket.isSuperAdmin) return true;
    let t;
    try {
      t = await Tournament.findById(tournamentId)
        .select("isPrivate clubId managerId")
        .lean();
    } catch (_) {
      return false;
    }
    if (!t) return false;
    if (!t.isPrivate) return true; // public — open to spectators
    if (socket.clubId && String(t.clubId) === socket.clubId) return true; // owning tenant
    if ((t.managerId || []).some((m) => String(m) === String(socket.userId))) return true; // assigned manager
    // Registered participant of this (private) tournament.
    try {
      const isParticipant = await Booking.exists({
        tournamentId,
        userId: socket.userId,
      });
      if (isParticipant) return true;
    } catch (_) {
      /* fall through to deny */
    }
    return false;
  }

  io.on("connection", (socket) => {
    const userId = socket.userId;

    // Join personal room for targeted messages
    socket.join(`user_${userId}`);
    console.log(`[SOCKET] User ${userId} connected`);

    // Broadcast online status
    socket.broadcast.emit("user:online", { userId, online: true });

    // Handle typing indicator
    socket.on("user:typing", ({ conversationId, isTyping }) => {
      socket.to(`conv_${conversationId}`).emit("user:typing", {
        userId,
        conversationId,
        isTyping,
      });
    });

    // Join conversation room — participant-checked. The HTTP layer already
    // refuses non-participants; without this the room was the way around it.
    socket.on("join:conversation", async ({ conversationId }) => {
      if (!(await canJoinConversation(userId, conversationId))) {
        return socket.emit("join:denied", {
          room: `conv_${conversationId}`,
          reason: "forbidden",
        });
      }
      socket.join(`conv_${conversationId}`);
    });

    // Leave conversation room
    socket.on("leave:conversation", ({ conversationId }) => {
      socket.leave(`conv_${conversationId}`);
    });

    // Join match room (for live scoring updates) — tenant-checked via the
    // match's owning tournament. Private tournaments are members-only.
    socket.on("join:match", async ({ matchId }) => {
      try {
        const result = await findMatchById(matchId);
        const tournamentId = result && result.match && result.match.tournamentId;
        if (!(await canJoinTournamentRoom(socket, tournamentId))) {
          return socket.emit("join:denied", { room: `match_${matchId}`, reason: "forbidden" });
        }
        socket.join(`match_${matchId}`);
      } catch (_) {
        socket.emit("join:denied", { room: `match_${matchId}`, reason: "error" });
      }
    });

    socket.on("leave:match", ({ matchId }) => {
      socket.leave(`match_${matchId}`);
    });

    // Join tournament room (for dashboard updates) — tenant-checked.
    socket.on("join:tournament", async ({ tournamentId }) => {
      if (!(await canJoinTournamentRoom(socket, tournamentId))) {
        return socket.emit("join:denied", { room: `tournament_${tournamentId}`, reason: "forbidden" });
      }
      socket.join(`tournament_${tournamentId}`);
    });

    socket.on("leave:tournament", ({ tournamentId }) => {
      socket.leave(`tournament_${tournamentId}`);
    });

    // Forum rooms removed — routes/forumChatRoutes.js was never mounted and has
    // been deleted. The join:forum handler deferred authorization to "the
    // message API layer", but the room broadcast was the leak, not the API.

    // Group chat rooms — membership-checked against the same helper the HTTP
    // layer uses (groupChatRoutes.js), so the two cannot drift apart again.
    // Note this is checked at join time only: removing a member revokes the API
    // immediately but leaves an already-joined socket in the room until it
    // reconnects. removeMember kicks the room to close that window.
    socket.on("join:gchat", async ({ chatId }) => {
      if (!(await canJoinGroupChat(userId, chatId))) {
        return socket.emit("join:denied", {
          room: `gchat_${chatId}`,
          reason: "forbidden",
        });
      }
      socket.join(`gchat_${chatId}`);
    });

    socket.on("leave:gchat", ({ chatId }) => {
      socket.leave(`gchat_${chatId}`);
    });

    // Disconnect
    socket.on("disconnect", () => {
      socket.broadcast.emit("user:online", { userId, online: false });
      console.log(`[SOCKET] User ${userId} disconnected`);
    });
  });
};
