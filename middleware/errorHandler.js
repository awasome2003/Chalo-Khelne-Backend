/**
 * Centralized error-handling middleware.
 * Mounted last, after all routes.
 */
const crypto = require("crypto");
const { captureException } = require("../utils/sentry");

module.exports = function errorHandler(err, req, res, _next) {
  // Correlation id: returned to the client for support, logged with the stack
  // server-side. The stack itself is NEVER sent to the client.
  const requestId = crypto.randomBytes(6).toString("hex");
  console.error(`[error ${requestId}] ${req.method} ${req.originalUrl}\n`, err.stack);

  if (err.name === "MulterError") {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File too large. Maximum size is 5MB.", requestId });
    }
    return res.status(400).json({ error: err.message, requestId });
  }

  // Report genuine server errors (5xx) to Sentry with correlation + tenant tags
  // (no-op unless configured). Client/validation errors above are not reported.
  captureException(err, {
    requestId,
    method: req.method,
    url: req.originalUrl,
    userId: req.user && (req.user.id || req.user._id),
    clubId: req.user && req.user.clubId,
  });

  res.status(500).json({ error: "Something broke!", requestId });
};
