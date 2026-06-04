/**
 * Scrub internal error detail from 5xx responses (single choke point).
 *
 * ~277 handlers across the codebase do `res.status(500).json({ error: err.message })`
 * or similar, leaking Mongoose/DB internals to clients. Rather than editing every
 * handler, this middleware wraps res.json once: on any >=500 response it replaces
 * `error`/`message` with a generic string and drops `stack`. A `requestId` (added
 * by errorHandler) is preserved so support can still correlate logs.
 *
 * Fail-closed: scrubs everywhere EXCEPT explicit `NODE_ENV === "development"`,
 * so a misconfigured/empty NODE_ENV in prod still hides internals. Dev keeps
 * full detail for debugging. <500 responses pass through untouched.
 */
module.exports = function scrubErrorResponses(req, res, next) {
  if (process.env.NODE_ENV === "development") return next();

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 500 && body && typeof body === "object" && !Array.isArray(body)) {
      const scrubbed = { ...body };
      if ("error" in scrubbed) scrubbed.error = "Internal server error";
      if ("message" in scrubbed) scrubbed.message = "Internal server error";
      delete scrubbed.stack;
      delete scrubbed.err;
      return originalJson(scrubbed);
    }
    return originalJson(body);
  };
  next();
};
