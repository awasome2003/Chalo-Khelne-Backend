/**
 * Centralized error-handling middleware.
 * Mounted last, after all routes.
 */
const crypto = require("crypto");
const { captureException } = require("../utils/sentry");

// Generic text per client-error status. The error's own message is NEVER sent:
// serve-static's ENOENT carries the absolute file path, and other libraries
// leak internals the same way.
const CLIENT_MESSAGES = {
  400: "Bad request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not found",
  405: "Method not allowed",
  409: "Conflict",
  413: "Payload too large",
  415: "Unsupported media type",
  429: "Too many requests",
};

module.exports = function errorHandler(err, req, res, _next) {
  // Correlation id: returned to the client for support, logged with the stack
  // server-side. The stack itself is NEVER sent to the client.
  const requestId = crypto.randomBytes(6).toString("hex");

  if (err.name === "MulterError") {
    console.warn(`[error ${requestId}] ${req.method} ${req.originalUrl} — ${err.code}`);
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File too large. Maximum size is 5MB.", requestId });
    }
    return res.status(400).json({ error: err.message, requestId });
  }

  // Honour a status the error already carries.
  //
  // This used to send 500 unconditionally. express.static (fallthrough:false)
  // reports a missing file as an error with status 404 — so every absent
  // upload answered 500 "Something broke!", logged a full stack, and was
  // reported to Sentry as a server fault. On a machine whose uploads/ folder
  // does not hold the production images, that is one false 500 per image on
  // every screen.
  const status = Number(err.status || err.statusCode) || 500;

  if (status >= 400 && status < 500) {
    // Client errors are expected traffic, not incidents: log one line, no
    // stack, and do not report them to Sentry.
    console.warn(`[error ${requestId}] ${req.method} ${req.originalUrl} — ${status}`);
    return res
      .status(status)
      .json({ error: CLIENT_MESSAGES[status] || "Request failed", requestId });
  }

  console.error(`[error ${requestId}] ${req.method} ${req.originalUrl}\n`, err.stack);

  // Report genuine server errors (5xx) to Sentry with correlation + tenant tags
  // (no-op unless configured). Client/validation errors above are not reported.
  captureException(err, {
    requestId,
    method: req.method,
    url: req.originalUrl,
    userId: req.user && (req.user.id || req.user._id),
    clubId: req.user && req.user.clubId,
  });

  res.status(status).json({ error: "Something broke!", requestId });
};
