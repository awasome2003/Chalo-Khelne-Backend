const jwt = require("jsonwebtoken");

module.exports = function setupSocket(io) {
  // Authenticate socket connections via JWT
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error("Authentication required"));
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      // Support both Player JWT (decoded.id) and Manager JWT (decoded.userId)
      socket.userId = decoded.id || decoded.userId;
      if (!socket.userId) return next(new Error("Invalid token payload"));
      next();
    } catch (err) {
      next(new Error("Invalid token"));
    }
  });

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

    // Join conversation room
    socket.on("join:conversation", ({ conversationId }) => {
      socket.join(`conv_${conversationId}`);
    });

    // Leave conversation room
    socket.on("leave:conversation", ({ conversationId }) => {
      socket.leave(`conv_${conversationId}`);
    });

    // Join match room (for live scoring updates)
    socket.on("join:match", ({ matchId }) => {
      socket.join(`match_${matchId}`);
    });

    socket.on("leave:match", ({ matchId }) => {
      socket.leave(`match_${matchId}`);
    });

    // Join tournament room (for dashboard updates)
    socket.on("join:tournament", ({ tournamentId }) => {
      socket.join(`tournament_${tournamentId}`);
    });

    socket.on("leave:tournament", ({ tournamentId }) => {
      socket.leave(`tournament_${tournamentId}`);
    });

    // Forum chat rooms
    socket.on("join:forum", ({ forumId }) => {
      socket.join(`forum_${forumId}`);
    });

    socket.on("leave:forum", ({ forumId }) => {
      socket.leave(`forum_${forumId}`);
    });

    // Group chat rooms
    socket.on("join:gchat", ({ chatId }) => {
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
